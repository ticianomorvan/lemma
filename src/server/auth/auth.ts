/**
 * Who may talk to the server. See docs/architecture.md → Security.
 *
 * - **Devices.** A paired browser holds a 256-bit token in an `HttpOnly;
 *   SameSite=Strict` cookie. Only the token's SHA-256 is kept, in
 *   `devices.json` in the config folder.
 * - **Pairing codes.** 128-bit, single use, valid for 5 minutes, kept in
 *   memory only (a restart forgets them). Opening `/pair/<code>` loads a page that redeems one with a POST.
 * - **Host and Origin.** Every request must name one of our hosts (this blocks
 *   DNS rebinding), and an `Origin`, when a browser sends one, must be ours.
 *   Browsers always send it on cross-origin requests and on WebSocket
 *   upgrades, so a request without it comes from a non-browser client, which
 *   still needs the cookie.
 * - **LAN mode.** While a phone is paired, or a phone's pairing code is
 *   waiting, `http://<lan-ip>:<port>` is one of our origins too; `setLan`
 *   adds and drops it, and `wantsLan` says whether it is needed.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Device } from "../../shared/protocol.ts";

const StoredDevice = Device.extend({ tokenHash: z.string() });
const DevicesFile = z.object({ devices: z.array(StoredDevice) });
type StoredDevice = z.infer<typeof StoredDevice>;

export const CODE_TTL_MS = 5 * 60 * 1000;
/** Chrome's ceiling for a cookie's lifetime. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export type AuthOptions = {
	/** Where `devices.json` lives (the config folder). */
	dir: string;
	/**
	 * The Vite dev server's origin (`http://127.0.0.1:5173`), which forwards
	 * `/api`, `/ws` and `/pair` here without rewriting Host or Origin. Set in
	 * dev only: the production build accepts its own origin alone.
	 */
	devOrigin?: string;
	now?: () => number;
};

/** Why a request was refused before any route saw it. */
export type Refusal = "bad_host" | "bad_origin";

/**
 * Made before the server binds, so a broken `devices.json` fails before any
 * port opens; `listen(port)` then names the hosts, origins and cookie. Until
 * it is called every request is refused.
 */
export class Auth {
	private readonly file: string;
	private readonly devOrigin: string | undefined;
	private origins = new Set<string>();
	private hosts = new Set<string>();
	/** Where pairing links point: the dev server in dev, else this server. */
	private base: string | null = null;
	/** Cookies are per host, not per port: two servers on 127.0.0.1 must not share one. */
	private cookieName = "";
	private readonly now: () => number;
	private devices: StoredDevice[];
	/** Pairing codes by hash: when each expires, and whether it is a phone's (LAN) code. */
	private readonly codes = new Map<
		string,
		{ expiresAt: number; lan: boolean }
	>();
	private port = 0;
	/** The LAN origin while LAN mode is on (`http://192.168.0.5:4317`). */
	private lanOrigin: string | null = null;

	constructor({ dir, devOrigin, now = Date.now }: AuthOptions) {
		this.file = join(dir, "devices.json");
		this.devOrigin = devOrigin;
		this.now = now;
		this.devices = readDevices(this.file);
	}

	/** The port the server listens on, on 127.0.0.1. */
	listen(port: number) {
		const own = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
		const origins = this.devOrigin ? [...own, this.devOrigin] : own;
		this.origins = new Set(origins);
		this.hosts = new Set(origins.map((o) => new URL(o).host));
		this.base = this.devOrigin ?? (own[0] as string);
		this.cookieName = `lemma-${port}`;
		this.port = port;
		if (this.lanOrigin) this.allow(this.lanOrigin);
		return this;
	}

	/**
	 * Turns LAN mode on for `address` (the LAN interface's IP), or off with
	 * null: its origin and Host join the allow-lists, and phone pairing links
	 * point at it.
	 */
	setLan(address: string | null) {
		if (this.lanOrigin) {
			this.origins.delete(this.lanOrigin);
			this.hosts.delete(new URL(this.lanOrigin).host);
		}
		this.lanOrigin = address
			? `http://${address.includes(":") ? `[${address}]` : address}:${this.port}`
			: null;
		if (this.lanOrigin) this.allow(this.lanOrigin);
	}

	/** The LAN origin while LAN mode is on. */
	get lan(): string | null {
		return this.lanOrigin;
	}

	/** Whether LAN mode is needed: a phone is paired, or a phone's code is waiting. */
	wantsLan(): boolean {
		this.prune(this.now());
		return (
			this.devices.some((d) => d.lan) ||
			[...this.codes.values()].some((c) => c.lan)
		);
	}

	private allow(origin: string) {
		this.origins.add(origin);
		this.hosts.add(new URL(origin).host);
	}

	/** The Host/Origin screen every request passes, routes and upgrades alike. */
	refuse(req: Request): Refusal | null {
		if (!this.hosts.has(req.headers.get("host") ?? "")) return "bad_host";
		const origin = req.headers.get("origin");
		if (origin !== null && !this.origins.has(origin)) return "bad_origin";
		return null;
	}

	/** The paired device whose cookie this request carries, if any. */
	check(req: Request): Device | null {
		const token = new Bun.CookieMap(req.headers.get("cookie") ?? "").get(
			this.cookieName,
		);
		if (!token || !this.cookieName) return null;
		const hash = sha256(token);
		const found = this.devices.find((d) => d.tokenHash === hash);
		return found ? publicDevice(found) : null;
	}

	/**
	 * A one-time link that pairs whichever browser opens it. With `lan` it is
	 * a phone's: it points at the LAN origin (LAN mode must be on), and the
	 * device it pairs keeps LAN mode on.
	 */
	startPairing({ lan = false } = {}): { url: string; expiresAt: string } {
		if (!this.base) throw new Error("call listen(port) first");
		if (lan && !this.lanOrigin) throw new Error("LAN mode is off");
		const now = this.now();
		this.prune(now);
		const code = randomBytes(16).toString("base64url");
		const expiresAt = now + CODE_TTL_MS;
		this.codes.set(sha256(code), { expiresAt, lan });
		return {
			url: `${lan ? this.lanOrigin : this.base}/pair/${code}`,
			expiresAt: new Date(expiresAt).toISOString(),
		};
	}

	/**
	 * Uses up a pairing code. The browser becomes a new device and gets its
	 * cookie, unless it is already paired: then the code (if any) is spent and
	 * nothing else changes, so opening any link again adds no device and still
	 * lets it in. Null for an unpaired browser with an unknown, used or
	 * expired code.
	 */
	redeem(
		code: string,
		req: Request,
	): { device: Device; cookie?: string } | null {
		const hash = sha256(code);
		const pending = this.codes.get(hash);
		const current = this.check(req);
		if (current || pending === undefined || pending.expiresAt <= this.now()) {
			this.codes.delete(hash);
			return current ? { device: current } : null;
		}
		const token = randomBytes(32).toString("base64url");
		const device: StoredDevice = {
			id: crypto.randomUUID(),
			name: deviceName(req.headers.get("user-agent") ?? ""),
			created: new Date(this.now()).toISOString(),
			...(pending.lan ? { lan: true } : {}),
			tokenHash: sha256(token),
		};
		// Spent only once the device is saved: a failed write keeps the link usable.
		this.save([...this.devices, device]);
		this.codes.delete(hash);
		const cookie = new Bun.Cookie(this.cookieName, token, {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			maxAge: COOKIE_MAX_AGE_S,
		});
		return { device: publicDevice(device), cookie: cookie.serialize() };
	}

	/** Forgets a device; its cookie stops working at once. False if unknown. */
	revoke(id: string): boolean {
		const rest = this.devices.filter((d) => d.id !== id);
		if (rest.length === this.devices.length) return false;
		this.save(rest);
		return true;
	}

	list(): Device[] {
		return this.devices.map(publicDevice);
	}

	private save(devices: StoredDevice[]) {
		writeDevices(this.file, devices);
		this.devices = devices;
	}

	private prune(now: number) {
		for (const [hash, { expiresAt }] of this.codes) {
			if (expiresAt <= now) this.codes.delete(hash);
		}
	}
}

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

const publicDevice = ({ id, name, created, lan }: StoredDevice): Device => ({
	id,
	name,
	created,
	...(lan ? { lan } : {}),
});

function readDevices(file: string): StoredDevice[] {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	try {
		return DevicesFile.parse(JSON.parse(text)).devices;
	} catch (error) {
		// Fail closed: a file we can't read pairs nobody, silently or not.
		throw new Error(`${file} is not valid (delete it to pair again): ${error}`);
	}
}

/** Atomic and private to the user: a temporary file renamed over the old one. */
function writeDevices(file: string, devices: StoredDevice[]) {
	mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify({ devices }, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, file);
}

const BROWSERS: [string, RegExp][] = [
	["Edge", /Edg(iOS|A)?\//],
	["Opera", /OPR\//],
	["Firefox", /(Firefox|FxiOS)\//],
	["Chrome", /(Chrome|CriOS)\//],
	["Safari", /Safari\//],
];
const SYSTEMS: [string, RegExp][] = [
	["iPhone", /iPhone/],
	["iPad", /iPad/],
	["Android", /Android/],
	["macOS", /Mac OS X/],
	["Windows", /Windows/],
	["Linux", /Linux/],
];

/** "Chrome en macOS", from the User-Agent, for the device list. */
export function deviceName(userAgent: string) {
	const pick = (list: [string, RegExp][]) =>
		list.find(([, re]) => re.test(userAgent))?.[0];
	const browser = pick(BROWSERS) ?? "Navegador";
	const system = pick(SYSTEMS);
	return system ? `${browser} en ${system}` : browser;
}
