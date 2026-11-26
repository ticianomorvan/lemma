/**
 * The photos a phone sends: what an upload may be (JPEG or PNG, told by its
 * bytes, never its name or declared type), how big, and the names the server
 * saves them under (`NNN-photo.jpg`), so it can tell its own files' types
 * from their names later.
 */
import { extname } from "node:path";
import type { AgentImage } from "./agent/driver.ts";
import type { Folder } from "./folder/folder.ts";
import { INBOX } from "./folder/layout.ts";

export type PhotoType = AgentImage["mediaType"];

/** 3.5 MiB: the client sends a ≤ 2048 px JPEG, usually under 1 MB. */
export const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;

const EXTENSIONS: Record<PhotoType, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
};

/** JPEG or PNG by the file's first bytes. */
export function sniffPhoto(bytes: Uint8Array): PhotoType | null {
	const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
		return "image/png";
	return null;
}

/** The name a photo of this type is saved under, before its number. */
export const photoName = (type: PhotoType) => `photo.${EXTENSIONS[type]}`;

/** The type a saved photo's name says; undefined for anything else. */
export function photoType(name: string): PhotoType | undefined {
	const ext = extname(name).toLowerCase();
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".png") return "image/png";
	return undefined;
}

/** A photo sent with no session open: `inbox/YYYY-MM-DD-NNN-photo.jpg`. */
export function saveToInbox(
	folder: Folder,
	bytes: Uint8Array,
	type: PhotoType,
) {
	const path = folder.saveAttachment(
		INBOX,
		bytes,
		photoName(type),
		`${new Date().toISOString().slice(0, 10)}-`,
	);
	return { id: path.slice(path.lastIndexOf("/") + 1), path };
}
