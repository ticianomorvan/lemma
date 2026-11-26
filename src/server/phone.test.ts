/**
 * Integration: a phone on the LAN, against FakeDriver. The LAN address is
 * `::1` here, a second loopback the test can reach like a phone reaches the
 * computer's Wi-Fi address.
 */
import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PairResponse } from "../shared/protocol.ts";
import { sniffPhoto } from "./http.ts";
import {
	authOf,
	Client,
	cleanUp,
	redeem,
	type Server,
	serve,
	turnEnds,
} from "./testing.ts";

afterEach(cleanUp);

const LAN = () => "::1";
const lanOrigin = (server: Server) => `http://[::1]:${server.port}`;

/** A JPEG as far as the server checks: its magic bytes, then noise. */
const jpeg = (size = 2048) => {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	bytes.set([0xff, 0xd8, 0xff, 0xe0]);
	return bytes;
};

const upload = (
	url: string,
	headers: Record<string, string>,
	bytes: Uint8Array<ArrayBuffer> = jpeg(),
	type = "image/jpeg",
) => {
	const form = new FormData();
	form.append("photo", new Blob([bytes], { type }), "IMG_0001.HEIC");
	return fetch(url, { method: "POST", body: form, headers });
};

/** Is anything answering at the LAN address? */
const lanUp = (server: Server) =>
	fetch(`${lanOrigin(server)}/api/state`).then(
		() => true,
		() => false,
	);

/** Pairs a phone through the desktop's QR, as the composer asks for it. */
async function pairPhone(
	server: Server,
	api: Awaited<ReturnType<typeof serve>>["api"],
) {
	const res = await api("/api/pair", { lan: true });
	expect(res.status).toBe(201);
	const { url } = (await res.json()) as PairResponse;
	expect(url).toStartWith(`${lanOrigin(server)}/pair/`);
	const redeemed = await redeem(url, {
		"user-agent":
			"Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
	});
	expect(redeemed.status).toBe(200);
	const cookie = (redeemed.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	return { cookie, origin: lanOrigin(server) };
}

test("a phone pairs over the LAN, and its photo reaches every client and Claude", async () => {
	const { server, api, id, driver, dir } = await serve(
		{ streams: ["math"] },
		{ lanAddress: LAN },
	);
	// No phone, no LAN listener.
	expect(await lanUp(server)).toBe(false);

	const phone = await pairPhone(server, api);
	expect(await lanUp(server)).toBe(true);
	const device = authOf(server)
		.list()
		.find((d) => d.lan);
	expect(device?.name).toBe("Chrome en Android");

	const desktop = await Client.subscribe(server, id);
	const onPhone = await Client.subscribe(server, id, phone);
	const lanHeaders = { cookie: phone.cookie, origin: phone.origin };
	const res = await upload(
		`${phone.origin}/api/sessions/${id}/attachments`,
		lanHeaders,
	);
	expect(res.status).toBe(201);
	const photo = (await res.json()) as { id: string; path: string };
	expect(photo.id).toBe("001-photo.jpg");
	expect(photo.path).toMatch(
		/^probabilidad\/sessions\/[\w-]+\/001-photo\.jpg$/,
	);

	// Both clients see it waiting, the phone included (it has its own listener).
	for (const client of [desktop, onPhone]) {
		await client.untilEvent(
			(e) => e.type === "attachments" && e.pending.length === 1,
		);
		expect(client.view().attachments).toEqual([photo]);
	}
	// And it's served like any study file.
	const file = await fetch(`${phone.origin}/files/${photo.path}`, {
		headers: lanHeaders,
	});
	expect(file.status).toBe(200);

	// Sent from the desktop with a comment: Claude gets it as an image.
	const sent = await api(`/api/sessions/${id}/messages`, {
		clientMsgId: "m1",
		text: "¿Está bien?",
		attachmentIds: [photo.id],
	});
	expect(sent.status).toBe(202);
	await Promise.all([desktop, onPhone].map(turnEnds(1)));
	expect(driver.pushedImages).toHaveLength(1);
	expect(driver.pushedImages[0]).toHaveLength(1);
	expect(driver.pushedImages[0]?.[0]?.mediaType).toBe("image/jpeg");
	expect(driver.pushed[0]).toContain(photo.path);
	for (const client of [desktop, onPhone]) {
		const view = client.view();
		expect(view.attachments).toEqual([]);
		expect(view.turns[0]?.user.attachments).toEqual([photo]);
	}
	// The .md links it as a plain Markdown image, and reloads with it.
	const md = await readFile(
		join(dir, `${photo.path.split("/").slice(0, -1).join("/")}.md`),
		"utf8",
	);
	expect(md).toContain(`![Foto](../../${photo.path})`);
	const late = await Client.subscribe(server, id);
	expect(late.snapshot.turns[0]?.user.attachments).toEqual([photo]);
});

test("the upload checks Origin, the cookie, the size and the type", async () => {
	const { server, api, id } = await serve(
		{ streams: ["math"] },
		{ lanAddress: LAN },
	);
	const phone = await pairPhone(server, api);
	const url = `${phone.origin}/api/sessions/${id}/attachments`;
	const headers = { cookie: phone.cookie, origin: phone.origin };
	const code = async (res: Response) =>
		((await res.json()) as { error: { code: string } }).error.code;

	// A multipart POST is a "simple" request: no JSON content-type to lean on.
	const foreign = await upload(url, { ...headers, origin: "http://evil.test" });
	expect(foreign.status).toBe(403);
	expect(await code(foreign)).toBe("bad_origin");
	const noCookie = await upload(url, { origin: phone.origin });
	expect(noCookie.status).toBe(403);
	expect(await code(noCookie)).toBe("unpaired");
	const html = await upload(
		url,
		headers,
		new TextEncoder().encode("<svg onload=alert(1)>"),
		"image/jpeg",
	);
	expect(html.status).toBe(415);
	expect(await code(html)).toBe("not_a_photo");
	const big = await upload(url, headers, jpeg(3.5 * 1024 * 1024 + 1));
	expect(big.status).toBe(413);
	const json = await fetch(url, {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: "{}",
	});
	expect(json.status).toBe(415);
	const missing = await upload(
		`${phone.origin}/api/sessions/nope/attachments`,
		headers,
	);
	expect(missing.status).toBe(404);
	const desktop = await Client.subscribe(server, id);
	expect(desktop.view().attachments).toEqual([]);
});

test("a revoked phone gets 403, and LAN mode ends with the last phone", async () => {
	const { server, api, id } = await serve(
		{ streams: ["math"] },
		{ lanAddress: LAN },
	);
	const phone = await pairPhone(server, api);
	const headers = { cookie: phone.cookie, origin: phone.origin };
	const url = `${phone.origin}/api/sessions/${id}/attachments`;
	expect((await upload(url, headers)).status).toBe(201);

	const device = authOf(server)
		.list()
		.find((d) => d.lan);
	const revoke = await api(`/api/devices/${device?.id}`, undefined, "DELETE");
	expect(revoke.status).toBe(204);
	// The listener is gone; were it back, the cookie would be refused.
	expect(await lanUp(server)).toBe(false);
	const again = await upload(
		`${server.url.origin}/api/sessions/${id}/attachments`,
		{ cookie: phone.cookie, origin: server.url.origin },
	);
	expect(again.status).toBe(403);
	// The LAN origin left the allow-list with it.
	const lanOriginNow = await upload(
		`${server.url.origin}/api/sessions/${id}/attachments`,
		{ cookie: phone.cookie, origin: phone.origin },
	);
	expect(lanOriginNow.status).toBe(403);
});

test("a photo with no session open goes to inbox/", async () => {
	const { server, api, dir } = await serve(
		{ streams: ["math"] },
		{ lanAddress: LAN },
	);
	const phone = await pairPhone(server, api);
	const res = await upload(`${phone.origin}/api/attachments`, {
		cookie: phone.cookie,
		origin: phone.origin,
	});
	expect(res.status).toBe(201);
	const { path } = (await res.json()) as { path: string };
	expect(path).toMatch(/^inbox\/\d{4}-\d{2}-\d{2}-001-photo\.jpg$/);
	expect((await readFile(join(dir, path))).length).toBe(2048);
});

test("no LAN, no phone code", async () => {
	const { api } = await serve(
		{ streams: ["math"] },
		{ lanAddress: () => null },
	);
	const res = await api("/api/pair", { lan: true });
	expect(res.status).toBe(409);
	expect((await api("/api/pair", {})).status).toBe(201);
});

test("sniffPhoto knows a JPEG and a PNG by their bytes, not their name", () => {
	expect(sniffPhoto(jpeg())).toBe("image/jpeg");
	const png = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
	]);
	expect(sniffPhoto(png)).toBe("image/png");
	expect(sniffPhoto(new TextEncoder().encode("GIF89a"))).toBeNull();
	expect(sniffPhoto(new Uint8Array([0xff, 0xd8]))).toBeNull();
});
