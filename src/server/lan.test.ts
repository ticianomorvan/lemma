import { expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { isPrivate, lanAddress } from "./lan.ts";

const v4 = (address: string, internal = false) =>
	({
		address,
		family: "IPv4",
		internal,
		netmask: "255.255.255.0",
		mac: "00:00:00:00:00:00",
		cidr: null,
	}) as NetworkInterfaceInfo;

test("LAN mode binds the Wi-Fi address, never loopback, a VPN or a public one", () => {
	expect(
		lanAddress({
			lo0: [v4("127.0.0.1", true)],
			utun4: [v4("100.101.102.103")],
			bridge0: [v4("10.0.0.5")],
			en0: [v4("192.168.0.242")],
		}),
	).toBe("192.168.0.242");
	expect(lanAddress({ eth0: [v4("172.20.1.9")] })).toBe("172.20.1.9");
	expect(
		lanAddress({ lo0: [v4("127.0.0.1", true)], en0: [v4("8.8.8.8")] }),
	).toBeNull();
	expect(lanAddress({})).toBeNull();
});

test("private ranges", () => {
	for (const ok of [
		"10.1.2.3",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
	]) {
		expect(isPrivate(ok)).toBe(true);
	}
	for (const no of [
		"172.15.0.1",
		"172.32.0.1",
		"192.169.0.1",
		"100.64.0.1",
		"::1",
	]) {
		expect(isPrivate(no)).toBe(false);
	}
});
