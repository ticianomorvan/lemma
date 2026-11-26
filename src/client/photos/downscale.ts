/**
 * A photo as the server takes it: a JPEG whose long edge is at most 2048 px,
 * drawn in a canvas on this device (docs/architecture.md → Files → Photos).
 * The camera's own file may be a 12 MP HEIC; the browser decodes it, so the
 * server never needs an image library.
 */

export const MAX_EDGE = 2048;
/** Under the server's 3.5 MB cap with room to spare. */
const TARGET_BYTES = 3 * 1024 * 1024;

export async function downscale(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
	const image = await decode(file);
	try {
		const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
		const width = Math.max(1, Math.round(image.width * scale));
		const height = Math.max(1, Math.round(image.height * scale));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no 2D canvas");
		// JPEG has no alpha: a transparent PNG gets a white page, not black.
		context.fillStyle = "#fff";
		context.fillRect(0, 0, width, height);
		context.drawImage(image.source, 0, 0, width, height);
		for (const quality of [0.85, 0.7, 0.5]) {
			const blob = await toJpeg(canvas, quality);
			if (blob.size <= TARGET_BYTES || quality === 0.5) return blob;
		}
		throw new Error("unreachable");
	} finally {
		image.close();
	}
}

type Decoded = {
	source: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
};

/** Decoded upright (EXIF orientation applied), as the camera held it. */
async function decode(file: Blob): Promise<Decoded> {
	try {
		const bitmap = await createImageBitmap(file, {
			imageOrientation: "from-image",
		});
		return {
			source: bitmap,
			width: bitmap.width,
			height: bitmap.height,
			close: () => bitmap.close(),
		};
	} catch {
		// Older Safari can't make a bitmap from every type an <img> decodes.
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.src = url;
		try {
			await img.decode();
		} catch (error) {
			URL.revokeObjectURL(url);
			throw error;
		}
		return {
			source: img,
			width: img.naturalWidth,
			height: img.naturalHeight,
			close: () => URL.revokeObjectURL(url),
		};
	}
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
			"image/jpeg",
			quality,
		),
	);
}
