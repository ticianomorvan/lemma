/**
 * A small text PDF for the Read view's tests, written by hand: one page per
 * entry of `pages`, each line set in Helvetica, so pdf.js gives it a text
 * layer to select from. Text is Latin-1 (WinAnsi), which covers Spanish.
 */
export function textPdf(pages: string[][]): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => objects.push(body);
	add("<< /Type /Catalog /Pages 2 0 R >>");
	const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
	add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
	add(
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	);
	pages.forEach((lines, i) => {
		const stream = [
			"BT",
			"/F1 13 Tf",
			"16 TL",
			"72 760 Td",
			...lines.map((l) => `(${escapePdf(l)}) Tj T*`),
			"ET",
		].join("\n");
		add(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
		);
		add(`<< /Length ${latin1(stream).length} >>\nstream\n${stream}\nendstream`);
	});

	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(latin1(out).length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = latin1(out).length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return latin1(out);
}

const escapePdf = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

function latin1(text: string) {
	return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/** The fixture course notes: four pages, with a theorem on page 3. */
export const NOTES = [
	[
		"Capitulo 1. Sucesiones",
		"Una sucesion es una funcion de los naturales en los reales.",
		"Escribimos a_n para el termino n-esimo.",
	],
	[
		"Capitulo 2. Limites",
		"Decimos que a_n tiende a L si para todo epsilon positivo",
		"existe N tal que |a_n - L| < epsilon para todo n > N.",
	],
	[
		"Capitulo 3. Propiedades",
		"Teorema 3. Toda sucesion convergente es acotada.",
		"Demostracion. Tomemos epsilon = 1 en la definicion de limite.",
		"Entonces |a_n| < |L| + 1 para todo n > N.",
	],
	["Capitulo 4. Ejercicios", "Ejercicio 1. Probar que 1/n tiende a 0."],
];
