# Lemma: a math-first study environment with Claude

Researched 2026-11-22. Versions noted were current then; re-check with `npm view` before the build.

## Goal

A study app for CS courses, kept apart from the coding tools. The first two courses it must serve are *Introducción a la Lógica y la Computación* and *Probabilidad y Estadística*; their materials are likely in Spanish.
- **Desktop.** One window with the material (a PDF or a note) on one side and a chat with Claude on the other.
- **Rendering.** Every answer renders LaTeX (inline and display), plots, charts and CS diagrams correctly while it streams.
- **Phone.** Its main job is to photograph a handwritten solution and drop it into the session running on the desktop.
- **Storage.** Everything lives as plain files in a study folder the user owns.

It worked when the user can do these in one sitting with no terminal or editor open:
1. Open a course PDF, select a theorem and ask "explain this".
2. Get an answer with aligned equations and a function plot.
3. Take a photo of an exercise on the phone and get it reviewed in the same chat.
4. Close the app, reopen it the next day, and find the session and its notes as Markdown in the folder.

## Not doing

- Hosting, accounts or sync servers. It runs on the user's own Mac, and the phone reaches it over the local network.
- Handling Claude credentials in any way (see Design → AI backend). This is a hard constraint, not a deferral.
- A native mobile app. The phone gets one web page.
- A general note editor. Obsidian or any editor can open the folder. The app reads and writes the files but is not trying to be an editor.
- Live TikZ. It is heavy and fragile in the browser, and Claude has to use Mermaid, DOT or plots instead. It can come later as an opt-in `tikz` block.
- Flashcards and spaced repetition. They are a candidate follow-up, not part of v1.

## What exists

There is no code yet, and this is a new open-source repository (MIT). Things to borrow from:
- **Claudian** (MIT, an Obsidian plugin that runs Claude Code over a Markdown folder) is a reference for driving the agent over a notes folder. The user doesn't use Obsidian, so it is not a base to build on.
- **Opcode** (formerly Claudia, Tauri 2 GUI for Claude Code) is the reference for sidecar and session handling if we wrap the app in Tauri later. Verify its license before copying any code.
- **assistant-ui's LaTeX guide** is the source of the delimiter and currency heuristics in `shared/normalize-math.ts` (rewritten in about 180 lines; their scanner is 2,100 lines because it also tracks HTML blocks and indented code, which our answers do not use).

## Design

**Shape: one local Bun server that owns all logic and state, and independent clients.**
- **The server** holds the agent sessions, the study folder, uploads and rendering conventions. `bun run start` serves the web client, an HTTP API and a WebSocket on the Mac.
- **Clients hold no state of their own.** Each one is a peer that connects to the server, loads a session and subscribes to its events (streamed tokens, new attachments, file changes). Closing one, or opening the same session in two places, loses nothing; both see the same stream.
- **Desktop client:** the web client installed as a browser app (Chrome's "Install app"), so it runs in its own window and Dock icon, separate from Chrome's tabs. Switching between it and Chrome is switching apps; neither lives inside the other.
- **Phone client:** the same web client, responsive, with a prominent camera button. It can drive a session fully, though its main job is sending photos.
- **Network.** The server binds to localhost by default. Pairing a phone turns on LAN access and issues that device a token (see Phone handoff).
- A desktop shell (Tauri 2) is an optional last slice. It would be one more client, not a different architecture.
- **Rejected: Tauri first.** It is lighter, but the Agent SDK needs Node or Bun, which means a sidecar with per-architecture binaries. The SDK also has a known problem locating its CLI under `bun build --compile`. That is packaging cost before any study value.
- **Rejected: Electron first.** It has no sidecar, but it is about 150 MB and still needs the HTTP server for the phone.
- **Rejected: forking Open Notebook, LibreChat or similar.** Each is built around provider APIs and its own database, not an agent over a local folder.

**AI backend: the Claude Agent SDK (TypeScript) `query()`, using the unmodified Claude Code binary it runs.**
- **Auth.** The app never shows a login, never reads tokens and never stores credentials. The user signs in once with `claude /login` (their own subscription) or sets `ANTHROPIC_API_KEY` / Bedrock / Vertex variables (bring your own key).
- **Why this is allowed.** Anthropic's [legal page](https://code.claude.com/docs/en/legal-and-compliance) bans third-party apps from offering claude.ai login or intermediating plan credentials. It says it does *not* prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". The [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) tells distributed products to use API keys. So the README documents both paths, the app adds nothing on top of them, and every user's usage is billed to that user.
- **Rejected: calling the Messages API directly.** It is simpler, but only an API key would work. Running the agent also gives file tools over the study folder, sessions and skills at no cost.

**Agent configuration.**
- `cwd` is the study folder. Allowed tools are `Read`, `Write`, `Edit`, `Glob`, `Grep` and `WebFetch`; no `Bash`.
- **A `calc` tool**, an in-process SDK MCP tool, so probability answers aren't mental arithmetic. It evaluates expressions with mathjs (combinations, factorials, `erf`) plus a distributions library (binomial, Poisson, normal, t, χ² PDFs, CDFs and quantiles). It runs in a restricted scope, with no `eval` and no imports. The system prompt tells Claude to use it for every number it states in a worked solution.
- **Language.** Claude answers in the language of the question (Spanish by default for these courses) and keeps standard notation.
- The SDK's own sessions are used for resume.
- A system-prompt append sets the answer conventions:
  - math only as `$…$` / `$$…$$`;
  - diagrams only in the fenced block kinds listed below;
  - point to sources as `file.pdf#p=12`.
- **Study modes are Agent SDK skills** stored in the folder's `.claude/skills/`, so the user can edit them as text. Modes: *read-along*, *explain*, *review my solution* (Socratic: point at the first wrong step, don't hand over the answer), *exam prep* (generate a timed practice set, then grade it).

**Study folder layout.** This is the only data model.
```
study/
  .claude/skills/…          study modes
  <course>/materials/       PDFs, .tex, .typ, .md from the course
  <course>/notes/           notes Claude or the user writes (.md or .typ)
  <course>/sessions/        one Markdown transcript per session, plus a front-matter `sdk_session_id`
  inbox/                    phone photos land here, then move to the session's course
```
- A session transcript is the source for the UI's history.
- Math stays as LaTeX source in the Markdown, so any editor shows it.

**Rendering pipeline (the core of the app).**
- **Math.** `react-markdown` + `remark-math` + `rehype-katex` (KaTeX 0.19.x), with a normalizer run on each streamed chunk first. The normalizer converts `\(…\)` / `\[…\]` to dollars and escapes currency dollars.
- **Half-received math.** It stays as raw text until the closing delimiter arrives, with no error flash. An unclosed inline `$x` is already text to remark-math; an unclosed display formula (`$$`, `\[`, `\(`) shows its source in a dashed `math-pending` block. The same holds after the stream stops, so an answer interrupted mid-formula never shows a KaTeX error.
- **Alternatives.** Vercel `streamdown` (with its math plugin) is the runner-up and is worth a spike if streaming jank shows up. Temml (MathML) is the fallback if KaTeX misses a construct the courses need.
- **Rejected: MathJax 4.** It has the widest coverage, but its typesetting is asynchronous and slower, which suits re-rendering on every chunk badly.
- **Copy.** The KaTeX `copy-tex` extension, so copying an equation yields its LaTeX.
- **Punctuation after math.** Glue it to the math with `white-space: nowrap`, so `$B$.` never wraps the period onto its own line. The prototype hit this. A rehype plugin (`client/markdown/glue.ts`) wraps inline math and touching punctuation, opening or closing, in `span.math-glue`.
- **Prototype.** `prototype/workspace.html` has the three explored layouts (Split, Notebook, Margin). Decided: they become two views of one session, Read (Margin plus an openable chat panel, which is Split) and Practice (Notebook). See `architecture.md` → Views.
- **Fenced blocks Claude may emit.** Each block kind has one renderer. All of them are declarative data, and none of them runs code Claude wrote.

  | Block | Renders with | For |
  |---|---|---|
  | `plot` | our JSON schema → Mafs or JSXGraph (spike picks one) | function graphs, Cartesian axes, points, shaded areas under a density, CDF step functions, PMF stem plots |
  | `vega-lite` | Vega-Lite | histograms, box plots, scatter plots of data |
  | `proof` | our JSON schema → nested KaTeX in a CSS tree layout | natural deduction trees and sequent calculus derivations (Gentzen style) |
  | `fitch` | our JSON schema → KaTeX lines with nested scope bars | Fitch-style proofs, if the course uses them |
  | `mermaid` | Mermaid 12, `securityLevel: 'strict'` | flowcharts, state machines, sequences |
  | `dot` | `@viz-js/viz` (Graphviz WASM) | automata, graphs, trees |
  | `typst` | typst.ts, lazy-loaded (~12 MB, cached) | Typst snippets, previews of `.typ` notes |

- **Why `proof` and `fitch` are our own blocks.** KaTeX has no `bussproofs`, the usual LaTeX package for proof trees, so Claude can't write them as math. Truth tables need nothing special: they are Markdown tables with inline math, and KaTeX covers the logic symbols (`\vdash`, `\models`, `\forall`, `\neg`, `\to`).
  - `proof` schema: `{conclusion, rule, premises:[…], discharged?}`, with every formula as LaTeX.
  - `fitch` schema: `{lines:[{formula, justification, depth}]}`.
- The `plot` schema, for example `{xDomain, yDomain, items:[{fn:"sin(x)"}, {point:[1,2], label:"P"}, {region:{fn, from, to}}, {stem:[[0,0.1],[1,0.3]]}]}`.
  - It gets parsed with a safe math expression parser, never `eval`.
  - A block that fails to parse shows its source and the error inline.
- **Rejected: Desmos.** It needs an API key and its terms are restrictive.

**PDF pane.**
- `react-pdf` (pdf.js 6.x) with its text layer.
- Selecting text and pressing "Ask" sends the quote, the file path and the page number.
- Claude can also `Read` the PDF pages itself for full context.
- EmbedPDF (PDFium) is the fallback if selection quality on scanned slides is poor.

**Phone handoff.**
- **Pairing.** The desktop shows a QR code for `http://<lan-ip>:<port>/pair/<one-time code>`. Opening it gives the phone a long-lived device token, stored in a cookie. The desktop can list and revoke paired devices.
- **Capture.** The phone's camera button is an `<input type=file accept=image/* capture=environment>`. It uploads each photo immediately and offers "take another".
- **Delivery.** The server saves the photo to `inbox/` and attaches it to whichever session the phone has open. Every client watching that session sees it arrive.
- No HTTPS is needed, because `capture` does not need a secure context. This is unverified on iOS, so slice 5 starts by testing it.
- Tailscale Serve is the documented option for off-LAN use.
- Claude reads the handwriting directly. Dedicated OCR (Mathpix) only if a test on 20 real photos shows Claude failing.

## Slices

Superseded by the ordered build plan in [plan.md](plan.md); kept here as the original proof list.

Each slice is shippable on its own, and its proof runs on a production build (`bun run build && bun run start`).

1. **Math chat.** The server streams `query()` to the UI and math renders.
   - Proof: `bun test` passes the normalizer fixtures (mixed delimiters, currency, half-received chunks).
   - Proof: a Playwright test streams a recorded response with `align`, `cases`, `pmatrix` and inline math, and asserts zero `.katex-error` and a screenshot.
   - Proof: one live question to Claude through the user's own login.
2. **Study folder, sessions and the `calc` tool.** Pick a folder, start a session per course, write the transcript to `sessions/*.md`, and resume after a restart. Two clients on one session see the same stream.
   - Proof: an integration test restarts the server and the resumed session recalls the earlier turn.
   - Proof: a test opens two WebSocket clients on one session, sends from one, and asserts both receive identical events.
   - Proof: `bun test` checks `calc` against known values (e.g. `binomcdf(10,0.3,4)`, `normcdf(1.96)`) and rejects `import`/`eval` input.
   - Proof: the `.md` file opens cleanly in another editor.
3. **Diagram blocks:** `plot`, `vega-lite`, `mermaid`, `dot`, `proof`, `fitch`.
   - Proof: a fixture page with one valid and one broken block of each kind. Playwright asserts each valid block renders and each broken one shows an inline error.
   - Proof: a 10-prompt check drawn from the two courses, with every block rendering. For example: "derivá $(p\to q)\to(\neg q\to\neg p)$ por deducción natural", "graficá la densidad normal y sombreá $P(X>1.5)$", "tabla de verdad de $p\lor\neg p$".
4. **PDF pane and "ask about selection".**
   - Proof: Playwright opens a fixture PDF, selects text on page 3, presses Ask, and asserts the outgoing message carries the quote and `#p=3`.
5. **Phone photo handoff.**
   - Proof: first, a manual iPhone test of `capture` over plain HTTP on the LAN.
   - Proof: then an automated test that pairs a device, POSTs an image, and checks it arrives in the session for every watching client. A revoked or bad token gets a 403.
6. **Study modes as skills.**
   - Proof: in *review my solution* on a seeded wrong proof, Claude names the first wrong step without giving the full solution. Check it by hand on 3 seeded exercises.
7. **Typst.** `typst` blocks, a preview of `.typ` notes, and an "export session to Typst/PDF" action.
   - Proof: a fixture block renders to SVG in under 1 s with the compiler warm, measured and printed.
   - Proof: the export compiles with the `typst` CLI.
8. **Optional desktop shell.** Only if the PWA window falls short.
   - Proof: a `.dmg` launches and the server child process exits when the app quits.

## Open questions

Settled 2026-11-22: no Obsidian; open source under MIT; README documents your own `claude` login or your own API key; server owns everything, clients are independent peers.

Also settled: the logic course uses several proof styles, so `proof` and `fitch` both stay; check them against the course notes in slice 3. It covers automata, so `dot` ships first among the diagram blocks and the 10-prompt check includes "dibujá el AFD que acepta cadenas con cantidad par de 0s". The architecture is in [architecture.md](architecture.md).

No open questions remain.
