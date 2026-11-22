# Lemma

Math-first study app: a local Bun server, stateless web clients, the Claude Agent SDK, and a study folder of plain files.

- **Start here.** Read `docs/plan.md` (ordered steps; one step is one PR), `docs/architecture.md` (modules, protocol, security) and `docs/spec.md` (product and rendering decisions). Follow them; if the code needs to differ, update the doc in the same PR.
- **Layout.** One package: `src/server`, `src/client`, `src/shared`. Only `src/server/agent` imports `@anthropic-ai/claude-agent-sdk`. Only `src/shared` is imported by both server and client.
- **Credentials.** Never add a login flow, read Claude credentials, or store tokens for Claude. Users sign in to the unmodified Claude Code binary themselves.
- **Checks.** `bun run check` must pass: typecheck, Biome, `bun test`, Playwright. Tests use `FakeDriver` and recorded streams in `test/fixtures/streams/`. Only `bun run test:live` calls Claude.
- **UI.** shadcn/ui on Base UI with Tailwind 4, bundled by Vite. Add components with `bunx --bun shadcn add <name>`, pin what it installs, and run `biome check --write`. Theme tokens live in `src/client/globals.css` and come from `prototype/workspace.html`; work from its patterns. Check changes in a browser at phone, tablet and desktop widths, in light and dark.
- **Product copy.** UI text is Spanish by default (the first users' courses are in Spanish). Code, docs and commits are in English.
