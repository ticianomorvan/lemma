/**
 * The one test that calls Claude, through your own login. Run it with
 * `bun run test:live`; plain `bun test` skips it.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentSession } from "./driver.ts";
import { SdkDriver } from "./sdk.ts";

const live = test.skipIf(!process.env.LIVE);
let dir = "";
let agent: AgentSession | undefined;
let events: AsyncIterator<AgentEvent> | undefined;

afterAll(async () => {
	agent?.close();
	if (dir) await rm(dir, { recursive: true });
});

/** Collects one turn's events, calling `during` on each as it arrives. */
async function turn(during?: (e: AgentEvent, all: AgentEvent[]) => unknown) {
	const all: AgentEvent[] = [];
	while (events) {
		const { value, done } = await events.next();
		if (done) throw new Error("the agent stopped mid-turn");
		all.push(value);
		await during?.(value, all);
		if (value.type === "turn_end") return all;
	}
	throw new Error("no agent");
}

const text = (all: AgentEvent[]) =>
	all.map((e) => (e.type === "delta" ? e.text : "")).join("");

live("a real turn reads a file and completes", async () => {
	dir = await mkdtemp("/tmp/lemma-live-");
	await writeFile(
		join(dir, "notas.md"),
		"La varianza de una Bernoulli es $p(1-p)$.\n",
	);
	agent = new SdkDriver(dir).start({ sessionId: crypto.randomUUID() });
	events = agent.events[Symbol.asyncIterator]();

	agent.push("Leé notas.md y decime en una línea qué fórmula aparece.");
	const all = await turn();
	expect(all).toContainEqual(
		expect.objectContaining({
			type: "block_start",
			kind: "tool",
			name: "Read",
		}),
	);
	expect(all).toContainEqual(
		expect.objectContaining({ type: "tool_result", ok: true }),
	);
	expect(text(all)).toContain("p(1-p)");
	expect(all.at(-1)).toMatchObject({ type: "turn_end", reason: "completed" });
});

live(
	"the same session takes a second turn and stops on interrupt",
	async () => {
		agent?.push(
			"Explicá con detalle el teorema central del límite, en seis párrafos.",
		);
		let asked = false;
		const all = await turn(async (e) => {
			if (e.type === "delta" && !asked) {
				asked = true;
				await agent?.interrupt();
			}
		});
		expect(asked).toBe(true);
		expect(all.at(-1)).toMatchObject({
			type: "turn_end",
			reason: "interrupted",
		});
		expect(all.some((e) => e.type === "error")).toBe(false);
	},
);

live(
	"answers follow the conventions: dollars for math, the question's language",
	async () => {
		agent?.push(
			"Sin herramientas: ¿cuál es la derivada de x^2 + 3x? Respondé en dos líneas.",
		);
		const answer = text(await turn());
		expect(answer).toMatch(/\$[^$]*2x[^$]*\$/);
		expect(answer).not.toMatch(/\\\(|\\\[/);
		expect(answer).toMatch(/derivada/i);
	},
);
