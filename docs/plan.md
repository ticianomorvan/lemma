# Lemma build plan

This is the ordered plan for building Lemma.
- [spec.md](spec.md) covers what and why.
- [architecture.md](architecture.md) covers the shape.

Each step below is one pull request. It ships on its own and is closed by the proof listed under it. The steps are also GitHub issues, and each issue links back here.

Versions checked on 2026-11-22. Pin these, and re-check with `npm view` when a step starts:

| Package | Version |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.330 |
| `react` | 19.3.1 |
| `katex` | 0.19.1 (forced with `overrides`: `rehype-katex` asks for 0.16) |
| `react-markdown` | 10.1.0 |
| `remark-math`, `rehype-katex` | 6.0.0, 7.0.1 |
| `remark-gfm`, `remark-breaks` | 4.0.1, 4.0.0 |
| `lucide-react` | 1.77.0 |
| `zod` | 4.6.7 |
| `mathjs` | 15.2.0 |
| `react-pdf` | 11.1.0 |
| `@viz-js/viz` | 3.31.0 |
| `@playwright/test` | 1.65.1 |
| `@biomejs/biome` | 2.6.8 |
| `vite` | 8.3.8 |
| `@vitejs/plugin-react` | 6.3.0 |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 |
| `shadcn` (CLI and CSS) | 4.23.0 |
| `@base-ui/react` | 1.9.0 |
| `typescript` | 7.0.2 |
| Bun | 1.4.x |

## Conventions for every step

- **One package.** Code lives in `src/server`, `src/client` and `src/shared`.
- **Imports.** Only `src/server/agent` imports the Agent SDK. Only `src/shared` is imported by both the server and the client.
- **Tests run offline.** They use `FakeDriver`, which replays recorded SDK streams from `test/fixtures/streams/*.jsonl`.
  - Only `bun run test:live` (`LIVE=1`) calls Claude, using your own login.
  - Record a new fixture when a step needs a new stream shape: `bun run record:stream <name> "<prompt>" [--interrupt-after <deltas>]`. Read the diff before committing it.
- **The proof runs on the production build:** `bun run build && bun run start`.
- **CI** (GitHub Actions on macOS) runs `bun run check`: typecheck, Biome, `bun test` and Playwright.
- **UI work** follows the `ui` skill (Emil Kowalski's guides) and is checked in a browser at desktop and phone widths, in light and dark mode.

## Steps

### 0. Scaffold
- **What:** Bun project, `tsconfig`, Biome, `bun test`, Playwright, Vite, Tailwind 4 and shadcn/ui (Base UI), and a CI workflow.
- **Commands:** `bun run dev | build | start | check`.
- **App:** a placeholder React page built with a shadcn component. Vite serves it in dev; `Bun.serve` serves the `vite build` output in `dist/` in production.
- **Proof:** CI is green on the first PR. `bun run start` serves the page, and a Playwright test sees its title.

### 1. Protocol, sessions and the fake agent
- **Protocol.** `shared/protocol` holds zod schemas for every route body and WebSocket message, using the event set in architecture.md.
- **Reducer.** `shared/reducer` builds `(snapshot, events) → view state`, and the server and client both use it.
- **Agent.** `server/agent` defines the `AgentDriver` interface, the real `SdkDriver`, and `FakeDriver`.
- **Sessions.** `server/sessions` holds the FIFO queue, the in-flight turn, `seq` and `epoch`, and publishes to the topic `s:<id>`.
- **HTTP.** `server/http` serves `state`, `sessions`, `messages`, `interrupt` and `/ws`. There is no auth yet; it binds to `127.0.0.1` only.
- **Proof** (an integration test with `FakeDriver`):
  - Two WebSocket clients receive identical events.
  - A client that joins mid-stream gets the snapshot plus the remaining events with no duplicates.
  - Two concurrent POSTs are answered in arrival order.
  - An interrupt ends the turn with `reason: interrupted`.

### 2. Math chat (first usable build)
- **What:** a client store fed by the WebSocket, a thread view, the composer (with stop), and `shared/normalize-math`.
- **Layout (chosen from three prototypes):** the notebook ("Cuaderno"): each exchange is a cell, the question a card, the answer full-width serif; the composer docked at the bottom with a floating stop pill; an index of questions in the right margin (a popover on narrow screens).
- **Rendering:** Markdown through `react-markdown` + `remark-math` + `rehype-katex`, plus `copy-tex`. Punctuation after math is kept on the same line.
- **Prompt:** the system-prompt append with the answer conventions and language rules.
- **Proof:**
  - `bun test` passes the normalizer fixtures (mixed delimiters, currency amounts, half-received chunks).
  - Playwright streams a recorded answer containing `align`, `cases`, `pmatrix` and inline math, and asserts zero `.katex-error`.
  - One live question goes through your own login.

### 3. Study folder, transcript, resume
- **What:** the `folder` module (path jail, atomic writes, watcher) and `transcript` (parse, append, body hash).
- **Behavior:** sessions are created as `.md` files. Resume or reseed follows architecture.md, and idle sessions close after 10 minutes.
- **Setup:** first run asks for the study folder and stores it in `config.json`.
- **Agent:** `Write` and `Edit` join, behind the path jail.
- **Proof:**
  - The transcript round-trips in `bun test`.
  - An integration test restarts the server and the session resumes.
  - A hand-edited `.md` makes the next send reseed instead of resume.
  - A symlink that points outside the folder is rejected.

### 4. Auth and pairing (loopback)
- **What:** device tokens (stored hashed, as an `HttpOnly` cookie), Host and Origin checks, and pairing codes.
- **Startup:** `bun run start` prints and opens `/pair/<code>` for the desktop. `POST /api/pair`, `GET /api/devices` and `DELETE /api/devices/:id`, with a device list in the header.
- **Proof:** these each get a 403:
  - a request with no token;
  - a WebSocket upgrade from a foreign origin;
  - a reused code;
  - a revoked token.

### 5. `calc` tool
- **What:** an in-process MCP server running mathjs (locked down) plus distributions, inside a Worker with a 1 s kill timeout.
- **Proof:** in `bun test`:
  - known values: `binomcdf(10,0.3,4)`, `normcdf(1.96)` and `invt(0.975, 9)`;
  - `import`, `evaluate` and an infinite loop are rejected.

### 6. Diagram blocks
- **Order:** `dot` first (automata), then `proof`, `fitch`, `plot`, `vega-lite` and `mermaid`.
- **Contract:** every block is declarative, and an invalid one renders its source with the error inline.
- **Proof:**
  - A fixture page holds one valid and one broken block of each kind, checked by Playwright.
  - A 10-prompt live check from both courses renders every block. It includes the even-0s DFA, a natural-deduction proof and a shaded normal density.

### 7. Combined Read view prototype (design only)
- **What:** add a fourth variant to `prototype/workspace.html`: Read with margin cards ↔ chat panel with pins, and the switch to Practice. Pick the details before step 8.
- **Proof:** the variant is reviewed in a browser at three widths, and you approve it.

### 8. Read view
- **What:** a PDF pane (`react-pdf`, with its text layer and `/files/*` Range support), and select → Ask or Note.
- **Behavior:** `anchor` on messages and the `notes` route; margin cards for the visible page; the chat panel with pins.
- **Proof:**
  - Playwright selects text on page 3, presses Ask, and asserts the outgoing message's anchor has `page: 3`.
  - A note appears as a card and in the `.md` as `> [!note]`.

### 9. Practice view
- **What:** the notebook rendering of the same thread, citations that open the drawer, and an instant view switch (shortcut plus segmented control).
- **Proof:** Playwright switches views without reloading and the thread state is identical. A citation opens the drawer at the anchored page.

### 10. Phone
- **What:** LAN mode while a device is paired, a QR code, the phone layout with a camera button, canvas downscaling, and attachments.
- **From step 4:** LAN mode adds `http://<lan-ip>:<port>` to the Host and Origin allow-lists in `auth` and makes pairing links use it. `GET /pair/:code` redeems on open, so a chat app's link preview could spend a shared link: the QR is the path, not a pasted URL.
- **Proof:**
  - A manual iPhone check that `capture` works over plain HTTP; do this first.
  - An integration test: pair a device, upload a photo, see it appear in every subscribed client. A revoked device gets a 403.

### 11. Study modes
- **What:** skills in `.claude/skills/` (read-along, explain, review, exam prep), the mode chips, and `mode` in the session's front matter.
- **Proof:** in *review*, 3 seeded wrong proofs each get their first wrong step named without the full solution. You check these by hand.

### 12. Typst
- **What:** `typst` blocks (typst.ts, lazy-loaded), a preview of `.typ` notes, and session export to `.typ`/PDF.
- **Proof:** a warm render takes under 1 s (measured and printed), and the export compiles with the `typst` CLI.

### 13. Installable app
- **What:** a PWA manifest and an app-shell service worker, so it can be installed as a Chrome app with its own Dock icon.
- **Proof:** it installs and opens in its own window, and works after the server restarts.

## Not yet planned
- A desktop shell (Tauri).
- TikZ blocks.
- Flashcards and spaced repetition.
- Dedicated OCR.

Each waits on a real need found while using Lemma.
