/**
 * `bun e2e/seed-device.ts <config dir> <port>`: pairs one device the way a
 * browser would (a code, then redeeming it) before the server starts, and
 * leaves its `name=token` cookie in `<config dir>/e2e-cookie` for the tests
 * (see fixtures.ts). The server then reads the same devices.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Auth } from "../src/server/auth/auth.ts";

const [dir, port] = process.argv.slice(2);
if (!dir || !port) throw new Error("usage: seed-device.ts <config dir> <port>");
const auth = new Auth({ dir }).listen(Number(port));
const code = auth.startPairing().url.split("/pair/")[1] ?? "";
const redeemed = auth.redeem(
	code,
	new Request(`http://127.0.0.1:${port}/`, {
		headers: { "user-agent": "Playwright" },
	}),
);
const cookie = redeemed?.cookie?.split(";")[0];
if (!cookie) throw new Error("pairing the e2e device failed");
writeFileSync(join(dir, "e2e-cookie"), cookie, { mode: 0o600 });
