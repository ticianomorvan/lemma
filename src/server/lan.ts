/**
 * The address LAN mode binds to: this machine's private IPv4 address on the
 * local network (Wi-Fi or Ethernet), so a phone on the same network can reach
 * it. Only that interface is bound, never `0.0.0.0`. VPN and Tailscale
 * addresses (100.64.0.0/10) are skipped: they aren't the phone's network.
 */
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

export function lanAddress(
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | null {
	const candidates = Object.entries(interfaces)
		.flatMap(([name, list]) => (list ?? []).map((info) => ({ name, info })))
		.filter(
			({ info }) =>
				info.family === "IPv4" && !info.internal && isPrivate(info.address),
		);
	// macOS names Wi-Fi and built-in Ethernet `en*`; prefer them over bridges.
	candidates.sort(
		(a, b) => Number(b.name.startsWith("en")) - Number(a.name.startsWith("en")),
	);
	return candidates[0]?.info.address ?? null;
}

/** 10/8, 172.16/12 and 192.168/16: the ranges home and campus networks use. */
export function isPrivate(address: string) {
	const [a = -1, b = -1] = address.split(".").map(Number);
	return (
		a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
	);
}
