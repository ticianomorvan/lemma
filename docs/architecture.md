# Lemma: architecture

Companion to [spec.md](spec.md), which settles the product, the rendering and auth. Decided 2026-11-22.

## How this was decided

- **The comparison.** Two candidates designed the architecture independently (Opus 5.5 and Sonnet 5.5), from the same brief. Neither saw the scoring criteria, which I wrote before they started.
- **Scores.**

  | Criterion (1–5) | A (Opus) | B (Sonnet) |
  |---|---|---|
  | Fewest moving parts | 4 | 4 |
  | Uses what the framework ships | 5 | 5 |
  | Stateless clients | 5 | 5 |
  | Folder is the truth | 5 | 3 |
  | Little for callers to know | 4 | 5 |

- **Where they agreed:** one Bun process with plain `Bun.serve` (no framework); a React client bundled by Bun; one long-lived streaming `query()` per open session; a FIFO send queue; snapshot plus sequence numbers instead of replay; a swappable `AgentDriver`; `calc` in a Worker; deny-by-default path checks.
- **Result.** A is the base. From B I took: commands over HTTP with a downstream-only WebSocket, server-assigned session ids, auth even on loopback, and `WebFetch` host limits.

## Processes

There is one process, `bun run start`. The Agent SDK spawns one `claude` child per *live* session. A session that has been idle for 10 minutes is closed, so no processes linger.

## Modules

There is one package, with no workspaces: `src/server`, `src/client`, `src/shared`.

| Module | Owns | Interface (what callers know) |
|---|---|---|
| `http` | `Bun.serve` routes, static `dist/`, WS upgrade, auth gate, zod validation | route table |
| `auth` | pairing codes, device tokens (hashed, in `devices.json`), Host/Origin checks | `new Auth({dir, devOrigin?})` (reads `devices.json` before the port binds), `listen(port)`, `refuse(req) → 'bad_host'\|'bad_origin'\|null`, `check(req) → Device\|null`, `startPairing() → {url, expiresAt}`, `redeem(code, req) → {device, cookie?}\|null`, `revoke(id)`, `list()` |
| `folder` | all I/O under the study root: path jail (`realpath`), atomic writes, recursive `fs.watch` (150 ms debounce, our own writes ignored by content hash) | `resolve` (the jail), `read`, `writeAtomic`, `list`, `watch`; `saveAttachment` in step 10 |
| `transcript` | Markdown session file ⇄ typed entries (question, answer, note) | `parse(md) → {meta, entries}`, `appendEntry(transcript, entry)`, `read`/`write`, `bodyHash(body)` |
| `sessions` | `Map<id, LiveSession>`: queue, in-flight turn, `seq`, reducer | `create`, `list`, `snapshot`, `send`, `interrupt`; `http` subscribes sockets to the topic `s:<id>` it publishes to |
| `agent` | **the only importer of the SDK**: builds the options, maps SDK messages to our events (`SdkMapper`, shared by `SdkDriver` and `FakeDriver`) | `AgentDriver.start({folder, resumeId?, seed?}) → Promise<{sdkSessionId, resumed, push, interrupt, close, events}>`: it resumes `resumeId` if the SDK still has it, else starts fresh with the seed |
| `tools/calc` | mathjs + distributions in a Worker; the in-process MCP server `study` that exposes it (`createSdkMcpServer`, `tool()`) lives in `agent/study.ts`, since only `agent` imports the SDK | `calc(expr) → value \| error` |
| `shared` | zod protocol schemas, the event reducer, `normalize-math` (`\(…\)`/`\[…\]` to dollars and escaping currency, after assistant-ui's heuristics, outside code; plus holding an unclosed display formula as raw source) | imported by server and client, so both reduce events identically |
| `client` | React SPA; state = snapshot + reducer over events, in a `useSyncExternalStore` store (`client/store.ts`); the thread view and composer in `client/thread/`; Markdown + KaTeX in `client/markdown/`; the diagram blocks in `client/blocks/` | — |

Tests swap `AgentDriver` for a fake that replays recorded SDK streams. That fake is what makes every integration and Playwright test run offline.

## Sessions and the source of truth

**The Markdown transcript in the folder is the truth.** The SDK's own session file is a cache, used only to make resuming cheap.
- **Why.** The SDK's storage sits under `~/.claude/projects/` and is keyed by the folder path. It is lost when the folder moves or the cache is cleaned. Redirecting it would mean touching the user's Claude Code config, which the auth constraint forbids.
- **Rejected: B's choice**, the SDK session as truth with the Markdown as a projection. It keeps history and model memory identical, but it breaks "the folder is the data model".

**Front matter:** `id`, `course`, `title`, `created`, `mode`, `sdk_session_id`, `sdk_body_hash`.

**Lifecycle:**
1. **Create.** `POST /api/sessions` generates the UUID and writes `<course>/sessions/<date>-<slug>.md` before the first turn (the slug comes from the title, or the id's first 8 characters). A missing course folder is made. The first message becomes the title when there is none.
2. **Open.** The first send starts `query({prompt: AsyncIterable<SDKUserMessage>, options})` in streaming-input mode, with these options:
   - `cwd`: the study root.
   - `settingSources: ['project']`, which loads `.claude/skills` and keeps the user's global hooks and MCP servers out.
   - `systemPrompt: {type: 'preset', preset: 'claude_code', append: conventions + course}`.
   - `includePartialMessages: true`.
   - `mcpServers: {study}`.
   - `canUseTool`, the path jail.
3. **Stream.** SDK messages are mapped to our own events. Raw SDK messages never reach clients, so an SDK update can't break the protocol.
4. **Write the transcript.**
   - The user message is appended when its turn starts (not when it is queued), so each answer follows its own question even when messages queue up. Queued messages a crash loses were never answered. Every append reads the file from disk first.
   - The assistant turn is appended at `turn_end`, with an atomic write.
   - The transcript is append-only and earlier turns are never rewritten. If the file changed on disk during a turn, the server re-reads it and appends to that version, so the user's edit survives.
5. **Interrupt.** `Query.interrupt()`. The partial answer is appended under `## Claude *(interrumpida)*` (Spanish, like the rest of the file a person reads). An answer cut by an error gets `*(error)*`.
6. **Resume.** When a session's agent starts, it gets `resumeId: sdk_session_id` only if `sdk_body_hash` matches the body just before the new question; the driver then resumes only if the SDK still has that session (`getSessionInfo(id, {dir: root})`). Otherwise it starts a fresh SDK session with a new random id, seeded with the transcript, and the next turn end records that id.
   - The server keeps one hash per live agent: the body as that agent knows it. Both front-matter fields are written when a turn ends and the file still matches that hash, so a crash mid-turn (or before the SDK saved anything) or an edit during the turn leaves a hash that no longer matches, and the next start reseeds.
   - An outside edit between turns no longer matches the live agent's hash either: the agent is closed before the next turn and a fresh one is seeded. An idle session also reloads its thread from the file and pushes a new snapshot.
   - The seed is sent as a text block before the first message, not in the system prompt, so it is part of the saved history a later resume brings back.
7. **Idle.** An agent idle for 10 minutes is closed. Its session stays loaded, and the next send resumes the SDK session.

## Client protocol

**Commands go over HTTP, and the WebSocket only pushes from the server.** Every action then shares one auth path and can be tested with `curl`.

**HTTP:**
- Every route below and `/ws` answer 403 `unpaired` without a valid device cookie, and 403 `bad_host` or `bad_origin` when the screen in Security refuses them. Only `GET /pair/:code` and the client's own files (the SPA shell and its bundle, which hold no data) skip the cookie.
- `GET /api/state` returns `folder` (null until first run sets it), courses (the folder's top-level folders, without `inbox` and dotfolders) and sessions (from the front matter, with the file's `updated` time). Devices come from `GET /api/devices`.
- `POST /api/folder {path}`: the first-run screen. It makes the folder if needed and stores it in `config.json`; 409 once a folder is set. Until then the session routes answer 409.
- `POST /api/sessions {course, title?, mode?}` returns `{id}`. `PATCH /api/sessions/:id {title?, mode?}` (`mode: null` clears it) rewrites the front matter and emits a `meta` event.
- `GET /api/sessions/:id` returns a snapshot, the same shape as the WebSocket one.
- `POST /api/sessions/:id/messages {clientMsgId, text, anchor?: {path, page, text}, attachmentIds?}`
- `POST /api/sessions/:id/notes {anchor, text?}`: your own highlight or note, stored in the transcript, with no Claude turn. Claude sees notes as context on the next send.
- `POST /api/sessions/:id/interrupt`
- `POST /api/sessions/:id/attachments` (multipart image) returns `{id, path}`.
- `GET /api/tree` and `GET /files/*path` (with Range support for pdf.js).
- `GET /pair/:code` redeems a pairing code: 303 to `/` with the device cookie, or 403 for an unknown, used or expired code (in production with the SPA shell, which shows "Este enlace ya no sirve" at that path). A browser that is already paired spends the code and gets no new device, so the startup link can open on every start.
- `POST /api/pair` returns `{url, expiresAt}`, a link for another browser (the phone's QR in step 10).
- `GET /api/devices` returns `{devices: [{id, name, created}], current}`. `DELETE /api/devices/:id` returns 204, and closes that device's open sockets with code 1008. In dev there is no SPA shell on the Bun server, so a used link gets a JSON 403 there.

**WebSocket `/ws`:**
- From the client: `{t: 'sub' | 'unsub', session}`.
- From the server:
  - `{t: 'snapshot', session, epoch, seq, status, meta, turns, inflight?, queue, notes, error?}`
  - `{t: 'ev', session, epoch, seq, e}`
  - `{t: 'folder', path, kind}`, to every socket, for a change made outside the app (our own writes are skipped)
  - `{t: 'error', session?, code, message}`, for a `sub` it can't serve (an unknown session or a malformed message).
- The schemas live in `src/shared/protocol.ts`, and `src/shared/reducer.ts` folds events into the view state (the snapshot minus `t`, `session`, `epoch` and `seq`). The server keeps its snapshot with that same reducer.

  `e` is one of:
  - `user_message {turnId, clientMsgId, from, text, anchor?, attachments, queued}`
  - `note {id, anchor, text?}`
  - `turn_start {turnId}`
  - `block_start {id, kind: text|thinking|tool, name?}`, then `delta {id, text}`, then `block_end {id}`
  - `tool_result {id, ok, summary}`
  - `turn_end {turnId, reason: completed|interrupted|error, usage: {inputTokens, outputTokens}}`
  - `meta {meta}`, when the title or mode changes
  - `error {code, message, clientMsgId?}`

  Block ids are `<API message id>:<index>`, because the SDK restarts block indices in every API message of a turn. A `tool` block's deltas carry its partial JSON input.

**Joining or reconnecting.** A `sub` gets the snapshot, and the socket subscribes to the topic `s:<id>` in the same tick. The server is single-threaded, so no event can fall between the two.
- The client drops any event with `seq <= snapshot.seq`.
- On a seq gap, or a changed `epoch` (the server restarted), it re-subscribes.
- No replay buffer is kept: one session's snapshot is small.
- A socket that falls behind is closed and re-subscribes: Bun's `backpressureLimit` (1 MiB) with `closeOnBackpressureLimit`, which also covers `server.publish`.

**Two clients sending at once.** Messages are queued in arrival order and broadcast at once with `queued: true`, then fed to the SDK one turn at a time. Any client can interrupt. Each sender matches its own message to the broadcast copy by `clientMsgId`.

## Views (client-only)

A session is one thread. Its views are lenses over that thread, chosen per client, and they change nothing on the server.
- **Read.** The material is in the centre. Anchored turns and notes for the visible page show as margin cards. Opening the chat panel shows the full thread beside the page, and the cards fold into numbered pins in the page gutter. Clicking a pin scrolls the panel.
- **Practice.** The thread as a notebook document. Anchors become citations that open the page in a drawer. Phone photos go here.
- **Switching** is instant (a keyboard shortcut and a segmented control, with no animation). Each client keeps its own view, so the desktop can be in Read while the phone is in Practice.
- **In the transcript,** entries sit under the exact headings `## Tú`, `## Claude` (or `## Claude *(interrumpida)*`, `## Claude *(error)*`) and `## Nota`. A line in an answer that reads exactly like one of them is written with a leading `\`. An anchor is a blockquote at the top of the question, `> [apunte.pdf, p. 3](../../<course>/materials/apunte.pdf#page=3)` followed by the quoted lines. A note is a `> [!note] <link>` blockquote with the quote nested (`> > …`) and the note's text after it. Session files always sit two folders deep, so the `../../` links open in any editor. Only answer text is written; thinking and tool calls are not.

## Files

```
study/
  .claude/skills/<mode>/SKILL.md
  <course>/materials/   <course>/notes/
  <course>/sessions/2026-11-22-<slug>.md
  <course>/sessions/2026-11-22-<slug>/001-photo.jpg   attachments, linked from the .md
  inbox/                photos sent while no session is open
~/Library/Application Support/lemma/   config.json (folder, port), devices.json (device names and token hashes)
                                       LEMMA_CONFIG_DIR moves it and LEMMA_STUDY_DIR overrides the folder, for tests
```

- **Photos.**
  - The phone downscales each photo to JPEG with a long edge of at most 2048 px in a canvas before upload. This avoids HEIC files and a native image library on the server.
  - The server sends it to Claude as an `image` block in the next user message.
  - The `.md` links it as a normal Markdown image.
  - Rejected: B's "Claude `Read`s the path". It costs a tool round trip on every photo.
- **External edits.** A `folder` event makes an open PDF or note pane show a "changed on disk" chip. The app never edits notes; Claude's `Edit` tool already refuses to edit a file that changed after it was read.

## Security

- **Network and auth.**
  - The server binds `127.0.0.1`, and LAN mode is on only while a paired device exists.
  - **Every request needs a device cookie, loopback included**, so another local process can't drive an agent that writes files. `bun run start` prints and opens a one-time `/pair/<code>` URL for the desktop. The phone pairs by QR code.
  - Codes are 128-bit, single use and expire after 5 minutes. They live in memory only, so a restart forgets them. Tokens are 256-bit, stored as an `HttpOnly; SameSite=Strict; Path=/` cookie for 400 days, and only their SHA-256 is kept on the server, in `devices.json` (mode 0600, written atomically). A `devices.json` that doesn't parse stops the server rather than pairing nobody.
  - The cookie is named `lemma-<port>`: cookies are per host, not per port, so two servers on `127.0.0.1` (the two e2e servers, say) must not share one.
  - The `Host` header is checked against an allow-list on every request, static files included (this blocks DNS rebinding): `127.0.0.1:<port>` and `localhost:<port>`.
  - `Origin`, when a request carries one, must be `http://127.0.0.1:<port>` or `http://localhost:<port>`; that covers POST, PATCH, DELETE and WebSocket upgrades, where browsers always send it. A request without `Origin` comes from a non-browser client, which still needs the cookie, so `curl` with the cookie works.
  - In dev only, the Vite origin `http://127.0.0.1:5173` (and its Host, which the proxy forwards unchanged) is trusted as well, and pairing links point at it. It takes an explicit `LEMMA_DEV=1`, which only the `dev:server` script sets, so a server started some other way doesn't trust whatever holds port 5173. `bun run start` (`NODE_ENV=production`) never trusts it; a test and an e2e check on the build prove it.
  - Revoking the last device leaves nobody to ask for a link, so the server prints a new one (it doesn't open a browser).
- **Agent.**
  - `disallowedTools: [Bash, NotebookEdit, Task]`.
  - Tools: `Read`, `Glob`, `Grep`, `Write`, `Edit` (`WebFetch` comes later).
  - The path jail (`agent/tools.ts`) resolves every path with `realpath` and allows only paths inside the root, so a symlink pointing out is refused. Globs with `..` or an absolute start are refused. Writes are denied under `.claude/` (except `skills/`), `<course>/sessions/` and `inbox/`, case-insensitively.
  - It runs as a `PreToolUse` hook and again in `canUseTool`. The hook is the one that matters: confirmed live in step 3, the SDK approves `Read`s inside `cwd` without calling `canUseTool`.
  - `WebFetch` is limited to public http(s) hosts and can be switched off. The remaining risk is a PDF injecting URLs into the conversation.
- **`calc`.**
  - A locked mathjs instance: `import`, `createUnit`, `evaluate`, `parse`, `simplify` and `derivative` are stubbed out, and so are `compile` and `parser` (the same reach as `evaluate`/`parse`) and `config` (it would change the instance for every later expression).
  - Only an allow-list of distribution functions is exposed (`src/server/tools/calc/distributions.ts`, from stdlib's `@stdlib/stats-base-dists-*`), named TI-84 style: `binompdf`, `binomcdf`, `invbinom`, `poissonpdf`, `poissoncdf`, `invpoisson`, `normpdf`, `normcdf`, `invnorm`, `tpdf`, `tcdf`, `invt`, `chi2pdf`, `chi2cdf`, `invchi2`. Each CDF is P(X ≤ x) at one point.
  - Input is capped at 2 KB and output at 10 KB.
  - Each call runs in its own Worker, killed after the call or after 1 s. Loading mathjs takes about 350 ms, so the next Worker is started as soon as one is taken, and the clock starts once it is ready. Calls run one at a time: Bun ignores Worker memory limits, and one call can allocate several GB (`zeros(1e9)`) in its second before it is killed, so this keeps that to one Worker. That brief spike is an accepted risk for a single-user local app.
  - An expression with nothing to show (empty, or a last line ending in `;`) is an error, so Claude never gets a blank result.
  - The hook and `canUseTool` let `mcp__study__calc` through; any other MCP tool name is refused.
  - The Worker has Bun's full APIs and no OS sandbox, so the mathjs lockdown is the boundary: a future mathjs escape would reach the machine. Keep mathjs pinned and re-run the escape checks when it is bumped.
- **Diagram blocks** render model-written source, so none of it runs as code.
  - `proof`, `fitch` and `plot` are JSON checked by zod schemas; `plot` expressions use our own parser (no `eval`); formulas go to KaTeX with `trust` off.
  - `proof`, `fitch` and `plot` JSON is refused past 64 levels of nesting before zod sees it. KaTeX runs with `maxSize: 10` and `maxExpand: 100`, so a formula can't draw a page-sized box or expand a macro bomb.
  - Graphviz, Mermaid and Vega output is parsed as SVG and sanitized (`client/blocks/sanitize-svg.ts`) against an allow-list: only drawing elements in the SVG namespace survive (no `script`, `foreignObject`, `image`, `use`, animation, or an XHTML `<img>`/`<meta>`). Links become plain groups. Event handlers, `href`/`src` attributes, and CSS that could fetch (escapes, `@import`, `image-set()`, a `url(...)` outside the document) are removed, in attributes and in `<style>`. The element is then inserted as a node, never re-serialized.
  - Mermaid runs with `securityLevel: 'strict'` and SVG labels. A diagram that brings its own config (`%%{init}%%`, front matter, `@{…}` shapes) is refused, and `secure` locks our keys against any directive missed.
  - Vega parses expressions to an AST run by `vega-interpreter` instead of `new Function`, and its loader refuses every URL, so a spec can't fetch or reach the network. Vega runs on the main thread, so keys that generate data are refused (`sequence`, `keyvals`, a bin `step`) and sizes are capped (`maxbins` 500, density `steps` 1000, `width`/`height`/`step` 4000).
  - The production server sends a Content-Security-Policy with every page (`CSP` in `server/http.ts`): scripts only from our bundle (plus `'wasm-unsafe-eval'` for Graphviz), `connect-src 'self'`, no objects, frames or `<base>`. It backs up the sanitizer; e2e/blocks.pw.ts fails on any violation.
  - Each source is size-capped. Graphviz and Vega still run on the main thread, so a hostile block under the caps can stall the tab; accepted for a single-user local app.
- **Accepted risk.** On the LAN, a cookie sent over plain HTTP can be sniffed. This is documented, and Tailscale Serve is the hardened option.

## Stack

- **Server.** Bun, with no framework, about 15 routes.
- **Client.** React 19, bundled by Vite (`root: src/client`).
  - UI is shadcn/ui on Base UI with Tailwind 4. Components are copied into `src/client/components/ui` with `bunx --bun shadcn add` and are ours to edit. AI Elements patterns (Message, Message Scroller, Trace, Code Block, Prompt Input) are built from those components and fed by our reducer, not by the AI SDK.
  - The theme in `src/client/globals.css` maps the prototype's tokens onto shadcn's variable names. Dark mode follows the system unless `<html data-theme>` overrides it.
  - Fonts (Inter, Source Serif 4) are self-hosted from `@fontsource-variable`, so the app works offline.
  - Lazy-loaded chunks: the Markdown renderer (react-markdown, KaTeX and the block dispatcher, `client/markdown/lazy.tsx`), then one chunk per block renderer (`client/blocks/`: viz.js, our `proof`, `fitch` and `plot`, Vega, Mermaid), and typst.ts in step 12. Step 6 took the first load from 941 kB of JavaScript to about 500 kB; an e2e test holds it under 560 kB. The PWA is a manifest plus a service worker that caches only the app shell.
- **Commands.**
  - `bun run dev`: the Vite dev server (port 5173, with React Fast Refresh) and the Bun server (port 4317) side by side. Vite forwards `/api`, `/pair` and `/ws` to Bun without rewriting `Host` or `Origin`, so the server's own checks still apply, and the server allows the dev origin only in dev. The server prints a pairing link on the Vite origin on every start, and opens it only while no device is paired, since `bun --watch` restarts it on every save.
  - `bun run build`: `vite build`, which bundles the client to `dist/`.
  - `bun run start`: serve `dist/`, `/api` and `/ws` on one port, then print and open the pairing link. `LEMMA_OPEN=0` keeps it from opening a browser (tests, CI).
- **Tests.**
  - `bun test`: the reducer, `normalizeMath`, open-fence detection in Markdown, the `plot` expression parser (known values; `constructor`, unknown names and deep nesting rejected), the prompt listing exactly what the renderers accept, the transcript round trip, `calc` (known values; `import`, `eval` and loops rejected), the path jail (symlink escapes), and auth.
  - Auth (`src/server/auth/auth.test.ts`): a 403 for no token on every route, a foreign Host, a foreign Origin (WebSocket upgrades too), a reused or expired code, a revoked token, the gated first-run `POST /api/folder`, and the dev origin outside dev.
  - Integration with the fake driver: two clients receive identical events, a client joining mid-stream gets the snapshot plus the tail, an epoch change after restart, the reseed when the hash differs, and a 403 after a device is revoked.
  - Playwright on the production build: streamed math with zero `.katex-error`, the diagram fixture page (`/fixtures/blocks.html`, a second Vite entry: one valid and one broken block of each kind, a block still streaming in, and link and click injection probes), a recorded answer with diagrams that never shows an error mid-stream, PDF select then Ask, and a phone-viewport upload seen from a second browser context. It runs the server with `LEMMA_FAKE=1`, which swaps in `FakeDriver`: messages replay `math-rich.jsonl` unless they end in a `<!--fixture:<name>-->` paragraph, and `LEMMA_FAKE_DELAY_MS` paces each SDK message. The same mode serves for trying the UI offline. `FakeDriver` saves a session once a turn reaches its `result`, like the SDK, so sharing one driver between two servers models a restart. `bun run test:e2e` builds first, then runs two servers on empty folders under `.e2e/`: one with a study folder and one at the first-run screen. Before each starts, `e2e/seed-device.ts` pairs one device through the `auth` module and leaves its cookie for `e2e/fixtures.ts`, so every test's browser starts paired; `unpaired(browser)` gives a context without it.
  - One live smoke test, only under `LIVE=1`.
- **SDK shapes, confirmed in step 1** (SDK 0.3.330, recorded in `test/fixtures/streams/`, documented in `src/server/agent/map.ts`):
  - `stream_event` is `{event, parent_tool_use_id, uuid, session_id, ttft_ms?}`, where `event` is a raw Messages API stream event. Block indices restart at 0 in every API message.
  - Tool results come back as `user` messages with `tool_result` content blocks.
  - Each turn ends with exactly one `result`. A normal turn has `subtype: success`, `terminal_reason: completed`. After `Query.interrupt()` it has `subtype: error_during_execution`, `is_error: true`, `terminal_reason: aborted_streaming`. `usage` is per turn, but `total_cost_usd` is cumulative over the `query()`, so we don't report cost per turn.
  - Thinking blocks stream with empty text unless a thinking display is requested. Since step 2 every session asks for `thinking: {type: 'adaptive', display: 'summarized'}`; the thread shows the summary folded under a "Pensando…" / "Pensó" row.
  - Queued sends in one `query()` can be merged into one turn, so the server pushes the next message only after the previous `result`.
  - `getSessionInfo(sessionId, {dir?})` exists and returns `{sessionId, summary, lastModified, …}` or `undefined`, which is what step 3's resume check needs.
- Tools are approved in `canUseTool`, never `allowedTools`, since a bare `allowedTools` entry bypasses `canUseTool`. `cwd` is the study folder.

## Rejected

- SQLite or an app-side event log, which would be a second store beside the files.
- A replay ring buffer.
- SSE.
- Hono, Elysia or tRPC.
- Next.js: server rendering and its own server would fight `Bun.serve` and our WebSocket.
- Bun's HTML imports for the client, tried in step 0. They work, but shadcn has no setup for them, the CLI build needs a custom script to run Tailwind, and Bun 1.4.4's CSS parser rejects some Tailwind output (`@supports (content: counter(line) / "")`, from shadcn's Code Block). Vite has first-class shadcn and Tailwind support and settled paths for the pdf.js worker, typst.ts WASM and the PWA.
- Workspaces.
- An agent worker process.
- A permission-prompt UI in v1, which would need a cross-client approval protocol.
- `sharp`.
- chokidar.
- A Docker sandbox for `calc`.
- One `query()` per turn, which loses interrupt and queuing and respawns `claude` every turn.
