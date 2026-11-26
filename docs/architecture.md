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
| `transcript` | Markdown session file ⇄ typed entries (question, answer with its text, thinking and tool parts, note) | `parse(md) → {meta, entries}`, `appendEntry(transcript, entry)`, `partsOf(blocks)`, `read`/`write`, `bodyHash(body)` |
| `sessions` | `Map<id, LiveSession>`: queue, in-flight turn, `seq`, reducer | `create`, `list`, `snapshot`, `send`, `interrupt`; `http` subscribes sockets to the topic `s:<id>` it publishes to |
| `agent` | **the only importer of the SDK**: builds the options, maps SDK messages to our events (`SdkMapper`, shared by `SdkDriver` and `FakeDriver`) | `AgentDriver.start({folder, resumeId?, seed?}) → Promise<{sdkSessionId, resumed, push, interrupt, close, events}>`: it resumes `resumeId` if the SDK still has it, else starts fresh with the seed |
| `modes` | the study modes: the default skills it ships (`server/modes/defaults/`), installing them into `.claude/skills/` where no file is, listing the folder's modes, and the `<mode>` note Claude gets | `installModes(folder)`, `listModes(folder) → [{id, label, description?}]`, `readSkill(folder, id)`, `modeMessage(folder, mode, known)` |
| `tools/calc` | mathjs + distributions in a Worker; the in-process MCP server `study` that exposes it (`createSdkMcpServer`, `tool()`) lives in `agent/study.ts`, since only `agent` imports the SDK | `calc(expr) → value \| error` |
| `shared` | zod protocol schemas, the event reducer, `normalize-math` (`\(…\)`/`\[…\]` to dollars and escaping currency, after assistant-ui's heuristics, outside code; plus holding an unclosed display formula as raw source) | imported by server and client, so both reduce events identically |
| `client` | React SPA; state = snapshot + reducer over events, in a `useSyncExternalStore` store (`client/store.ts`); the thread view and composer in `client/thread/`; the Read view in `client/read/` (react-pdf pages, anchors, margin, pins); Markdown + KaTeX in `client/markdown/`; the diagram blocks in `client/blocks/`; the 640 / 1024 px layouts from one `useLayout()` (`client/layout.ts`) | — |

Tests swap `AgentDriver` for a fake that replays recorded SDK streams. That fake is what makes every integration and Playwright test run offline.

## Sessions and the source of truth

**The Markdown transcript in the folder is the truth.** The SDK's own session file is a cache, used only to make resuming cheap.
- **Why.** The SDK's storage sits under `~/.claude/projects/` and is keyed by the folder path. It is lost when the folder moves or the cache is cleaned. Redirecting it would mean touching the user's Claude Code config, which the auth constraint forbids.
- **Rejected: B's choice**, the SDK session as truth with the Markdown as a projection. It keeps history and model memory identical, but it breaks "the folder is the data model".

**Front matter:** `id`, `course`, `title`, `created`, `mode`, `sdk_session_id`, `sdk_body_hash`.

**Lifecycle:**
1. **Create.** `POST /api/sessions` generates the UUID and writes `<course>/sessions/<date>-<slug>.md` before the first turn (the slug comes from the title, or the id's first 8 characters). A missing course folder is made. The first message becomes the title when there is none: its first line, at most 60 characters of plain text, with inline math kept as `$…$` and never cut mid-formula (`shared/title.ts`). The header, the session list and the print heading render that math with KaTeX; a browser tab, a tooltip and a PDF's file name show it as plain text (`{,}` as a comma, commands as Unicode, no `$`). Titles from before step 12 lost their `$` but kept the TeX, and get the same plain-text cleaning.
2. **Open.** The first send starts `query({prompt: AsyncIterable<SDKUserMessage>, options})` in streaming-input mode, with these options:
   - `cwd`: the study root.
   - `settingSources: ['project']`, which keeps the user's global hooks and MCP servers out.
   - `skills: []`: no skill is listed for Claude; study modes reach it as text (Study modes below).
   - `systemPrompt: {type: 'preset', preset: 'claude_code', append: conventions + course}`.
   - `includePartialMessages: true`.
   - `mcpServers: {study}`.
   - `canUseTool`, the path jail.
3. **Stream.** SDK messages are mapped to our own events. Raw SDK messages never reach clients, so an SDK update can't break the protocol.
4. **Write the transcript.**
   - The user message is appended when its turn starts (not when it is queued), so each answer follows its own question even when messages queue up. Queued messages a crash loses were never answered. Every append reads the file from disk first.
   - The assistant turn is appended at `turn_end`, with an atomic write: its text, thinking summaries and tool calls, in the order they streamed (format in Views → In the transcript), so a reload shows the same thread.
   - What Claude gets for a question: the study mode when it changed (below), the notes added since its last message (`<notes>`), the passage it quotes with its file and page (`<passage path page>`), then the text. "Since its last message" is read from the file: the notes after the last `## Tú`. A note never makes the agent start over: when it is appended, a live agent's hash and the front matter's `sdk_body_hash` that matched the file before it are moved past it, so a later resume still happens and the next message carries the note. An agent seeded from the file already has the notes and gets none.
   - The transcript is append-only and earlier turns are never rewritten. If the file changed on disk during a turn, the server re-reads it and appends to that version, so the user's edit survives.
5. **Interrupt.** `Query.interrupt()`. The partial answer is appended under `## Claude *(interrumpida)*` (Spanish, like the rest of the file a person reads). An answer cut by an error gets `*(error)*`.
6. **Resume.** When a session's agent starts, it gets `resumeId: sdk_session_id` only if `sdk_body_hash` matches the body just before the new question; the driver then resumes only if the SDK still has that session (`getSessionInfo(id, {dir: root})`). Otherwise it starts a fresh SDK session with a new random id, seeded with the transcript, and the next turn end records that id.
   - The server keeps one hash per live agent: the body as that agent knows it. Both front-matter fields are written when a turn ends and the file still matches that hash, so a crash mid-turn (or before the SDK saved anything) or an edit during the turn leaves a hash that no longer matches, and the next start reseeds.
   - An outside edit between turns no longer matches the live agent's hash either: the agent is closed before the next turn and a fresh one is seeded. An idle session also reloads its thread from the file and pushes a new snapshot.
   - The seed is sent as a text block before the first message, not in the system prompt, so it is part of the saved history a later resume brings back.
7. **Idle.** An agent idle for 10 minutes is closed. Its session stays loaded, and the next send resumes the SDK session.

## Study modes

A mode is an Agent SDK skill in the study folder, `.claude/skills/<mode>/SKILL.md`, and the session's front matter names it (`mode: review`). The student edits a mode as text, or adds one: any `.claude/skills/<id>/SKILL.md` with a kebab-case folder name is a mode, labelled by its front matter's `label` (else its id) and explained by its `description`.
- **Defaults.** The app ships four, in Spanish because they shape Claude's replies: `read-along` (Leer juntos), `explain` (Explicar), `review` (Revisar: Socratic, names the first wrong step and asks, never the corrected step or a full solution) and `exam-prep` (Examen: a timed practice set, then grading). Whenever a study folder opens (at start and on first run), each one is written only where no file is, with an exclusive create (`O_EXCL`), so an edited mode is never overwritten. A deleted default comes back on the next start; a renamed or rewritten one stays as the student left it. A changed default in a later app version reaches new folders only.
- **How a mode steers Claude.** The server sends the mode's SKILL.md body (without its front matter) as a `<mode name label>` block ahead of the first message after the mode changed, and a "the mode is off" note when it was cleared. The SKILL.md is read as each message goes out, and the live agent remembers the last block it got (`null` for a fresh agent: no mode; unknown for a resumed one). So a change made mid-turn applies to the next message, so does an edit of the current mode's SKILL.md, and an unchanged mode costs nothing per turn. A mode whose SKILL.md is gone counts as off. A resumed agent in a session with no mode gets one "off" note, since its saved history may hold an older mode. Every new agent gets the block with its first message: one reseeded from the file (an edit, or an SDK cache that is gone) never saw it, and the seed doesn't carry it; one resumed after the idle close or a restart may have seen an older mode. The block is not written to the transcript, which keeps the student's words.
  - **Why not the Skill tool.** With `settingSources: ['project']` the SDK (0.3.330) does discover the folder's skills, but whether to load one would be Claude's call each turn, from the description, and the mode is the student's choice. The options are also fixed when `query()` starts, so a mode change can't change the system prompt mid-session. A live probe (`skills: []` and `'all'`, with the Skill tool not in `tools`) had Claude answer that it could invoke no skill either way, so `skills: []` only keeps them out of the listing.
- **The jail.** Claude may read `.claude/skills/` (the path jail allows reads anywhere in the folder) and write there (writes under `.claude/` are denied except `skills/`), so it can edit a mode when the student asks. `/files/*` still hides it, like every hidden segment.
- **Routes.** `GET /api/state` lists `modes`. `POST /api/sessions` and `PATCH /api/sessions/:id` take a mode only if its SKILL.md exists (400 otherwise).

## Client protocol

**Commands go over HTTP, and the WebSocket only pushes from the server.** Every action then shares one auth path and can be tested with `curl`.

**HTTP:**
- Every route below and `/ws` answer 403 `unpaired` without a valid device cookie, and 403 `bad_host` or `bad_origin` when the screen in Security refuses them. Only `/pair/:code` and the client's own files (the SPA shell and its bundle, which hold no data) skip the cookie.
- `GET /api/state` returns `folder` (null until first run sets it), courses (the folder's top-level folders, without `inbox` and dotfolders), sessions (from the front matter, with the file's `updated` time) and modes (`[{id, label, description?}]`, from `.claude/skills/`). Devices come from `GET /api/devices`.
- `POST /api/folder {path}`: the first-run screen. It makes the folder if needed and stores it in `config.json`; 409 once a folder is set. Until then the session routes answer 409.
- `POST /api/sessions {course, title?, mode?}` returns `{id}`. `PATCH /api/sessions/:id {title?, mode?}` (`mode: null` clears it) rewrites the front matter and emits a `meta` event. A mode must be a kebab-case id with a SKILL.md in `.claude/skills/` (400 otherwise).
- `GET /api/sessions/:id` returns a snapshot, the same shape as the WebSocket one.
- `POST /api/sessions/:id/messages {clientMsgId, text, anchor?: {path, page, text}, attachmentIds?}`
- `POST /api/sessions/:id/notes {anchor, text?}` returns 201 `{id}`: your own highlight or note (the quote must not be empty), stored in the transcript and broadcast as a `note` event, with no Claude turn. Claude sees notes as context on the next send.
- `POST /api/sessions/:id/interrupt`
- `POST /api/sessions/:id/attachments` (multipart, one `photo` field) returns 201 `{id, path}`: a photo waiting for the session's next message, saved as `<session folder>/NNN-photo.jpg` (or `.png`) and broadcast as an `attachments` event. A multipart POST is a CORS "simple" request, so unlike the JSON routes it can't lean on the content-type check: it has only the Origin screen and the cookie. The body is capped at 3.5 MiB (413), and the type comes from the file's first bytes, JPEG or PNG only (415 `not_a_photo`); the name and the declared type are ignored (`server/photos.ts`). `DELETE /api/sessions/:id/attachments/:attachment` drops a waiting photo (204, or 404). `POST /api/attachments`, the same upload with no session open, saves to `inbox/YYYY-MM-DD-NNN-photo.jpg` and returns `{id, path}`.
- `GET /api/courses/:course/materials` returns `{files: [{path, name}]}`: the PDFs under `<course>/materials/` (three folders deep), for Read's file menu. (`GET /api/tree` waits for a view that browses the whole folder.)
- `GET /files/*path`: a file in the study folder, for pdf.js.
  - One `bytes=` range gets 206 with `Content-Range`; an unsatisfiable or multi-range header gets 416. pdf.js runs with `disableAutoFetch` and `disableStream`, so it reads only the ranges it needs.
  - The path goes through the folder's jail (`realpath`); a hidden segment (`.claude/…`), a folder, or anything outside the root (a `..`, an absolute path, a symlink out) is a 404.
  - The type comes from an allow-list (PDF, PNG, JPEG, Markdown, text); anything else is `application/octet-stream` with `Content-Disposition: attachment`. Every answer carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`, so a file opened in a tab never runs as a page of this origin.
- `GET /pair/:code` only serves the SPA shell (`no-store`), and the page redeems the code with `POST /pair/:code` (same-origin, so it carries `Origin` and passes the screen). Whatever fetches a link without running it — a chat app's preview, a prefetch — spends nothing, and a prerendered page waits for `prerenderingchange` before it posts. The POST returns `{next}` with the device cookie, where `next` is the `?next=/s/<id>` the link carried (a phone's QR opens the desktop's session) or `/`; or 403 `bad_code` for an unknown, used or expired code, and the page shows "Este enlace ya no sirve" (or "No se pudo vincular" with a retry when the POST never got an answer: the code is still good). The page posts once per load, so React's StrictMode double effect in dev can't spend the code twice. A browser that is already paired always gets `{next}`: it spends the code if there is one and gets no new device, so the startup link can open on every start, and a link spent twice by the same browser isn't a dead end. In dev, Vite serves the shell for the GET and forwards the POST.
- `POST /api/pair` returns `{url, expiresAt}`, a link for another browser. `POST /api/pair {lan: true}` is the phone's QR: it turns LAN mode on (409 `no_lan` with no local network) and the link is on the LAN origin. An unused LAN code keeps LAN mode on until it expires.
- `GET /api/devices` returns `{devices: [{id, name, created, lan?}], current}`; `lan` marks a phone paired over the LAN. `DELETE /api/devices/:id` returns 204, closes that device's open sockets with code 1008, and ends LAN mode if it was the last phone.

**WebSocket `/ws`:**
- From the client: `{t: 'sub' | 'unsub', session}`.
- From the server:
  - `{t: 'snapshot', session, epoch, seq, status, meta, turns, inflight?, queue, notes, attachments, error?}`; `attachments` are the photos waiting for the next message, `[{id, path}]`.
  - `{t: 'ev', session, epoch, seq, e}`
  - `{t: 'folder', path, kind}`, to every socket, for a change made outside the app (our own writes are skipped)
  - `{t: 'error', session?, code, message}`, for a `sub` it can't serve (an unknown session or a malformed message).
- The schemas live in `src/shared/protocol.ts`, and `src/shared/reducer.ts` folds events into the view state (the snapshot minus `t`, `session`, `epoch` and `seq`). The server keeps its snapshot with that same reducer.

  `e` is one of:
  - `user_message {turnId, clientMsgId, from, text, anchor?, attachments, queued}`; `attachments` are the photos it took from the waiting list (`attachmentIds` on the send; ids no longer waiting are skipped, and a send left with no text and no photo is a 400).
  - `attachments {pending}`, the waiting photos after an upload or a removal.
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
- **Switching** is instant (a keyboard shortcut and a segmented control, with no animation). Each client keeps its own view, so the desktop can be in Read while the phone is in Practice. Only the view mounts: the session's store, its socket and its snapshot stay, so nothing is fetched again. What survives a switch is kept in the session's shell (`chat-app.tsx`):
  - the composer's text, shared by Practice and Read's chat panel;
  - Practice's scroll, kept by question (the first one in view and its offset) rather than by pixels, and held there while answers above it finish drawing, until the reader moves;
  - Read's file, its place in the pages (a page and a fraction of it, `PagePlace` in `anchors.ts`) and whether the chat was open;
  - a citation open in Practice: switching to Read opens Read on that file, where the drawer was scrolled, and the drawer does not reopen on the way back.

  Read's drafts (a margin card, or a passage quoted above the composer) and an open card list don't survive. Rows already in the thread when it mounts appear at once; only new ones animate in.
- **Read in detail.** Step 7 compared three designs in a dev-only route and chose the one called *Capas*; step 8 built it on react-pdf and the store, and deleted the route.
  - **The page.** react-pdf (pdf.js) draws the course PDF with its text layer, from `/files/*`, in a lazy chunk (`client/read/pdf-pages.tsx`). Only pages within a screen and a half are drawn; the rest keep their place. react-pdf suspends while loading, so the file and each page have their own Suspense boundary. In dark mode the canvas is inverted and dimmed.
  - **Which file.** A pill at the top left shows the file and "p. N de M"; with more than one PDF in `<course>/materials/` it opens a menu of them. Read opens the file this client last chose for the session (kept in `localStorage`), else the file the thread quoted last, else the first. A course with no PDFs stays in Practice: "Leer" is disabled, and its tooltip says where to put them.
  - **Anchors on the page.** An anchor is `{path, page, text}`: the selection's text, whitespace collapsed, and the page the selection starts on. `client/read/anchors.ts` finds the quote in its page's text layer ignoring whitespace and keeps it as a DOM Range; the margin, the pins, a click on a passage and the highlights all ask it, so only it and the page renderer know the page's markup. Highlights use the CSS Custom Highlight API (`lemma-question` fills, `lemma-note` underlines, `lemma-active` for the hovered or drafted one), repainted from the current thread, so a passage whose turn or note is gone is no longer painted. The text layer multiplies with the canvas, so a highlight tints the text instead of covering it.
  - **Cards.** One card per passage, at the passage's height, for the drawn pages. A passage with several questions and notes shows as one pile with a count and their badges; clicking it opens the list, and clicking a question opens its full answer in place, with "Seguir en el chat". A card that would overlap the one above is pushed down, with a thin leader line back to its passage. Hovering a card or its highlight emphasises both. Highlights fill a passage with questions and underline one with only notes. Notes have no place in the thread's order, so they show only as cards and pins.
  - **Select → Ask / Note.** Selecting text on a page shows a floating "Preguntar · Nota" bar (below the selection on touch screens, clear of the system menu). With the chat closed, either one opens a draft card in the margin at the selection's height; with it open, Ask quotes the selection above the composer.
  - **Pins.** With the chat open, each passage folds into a bar along its left edge with a count, as tall as the passage (the height the margin layout measured). A bar for a single question scrolls the panel to it; a bar for several opens a short list first. The bars' column is always reserved, so opening the chat never moves the page.
  - **Panel.** On a desktop (from 1024 px) the chat opens over the margin (440 px), and the page stays put. On a tablet (640–1023 px) there is no room to cover the page, so the chat pushes it aside (360 px). Citations in the panel scroll the page to their passage and flash it.
  - **Segmented control.** "Leer · Practicar" sits in the header after the session title, with icons and labels; icons only on a phone. Its tooltip shows the shortcut, ⌥1 / ⌥2 (Alt+1 / Alt+2 elsewhere), matched by key position. Until a client picks a view, a session opens in Read when its course has PDFs and in Practice otherwise.
  - **Phone (below 640 px).** No margin: a strip along the bottom holds the visible page's cards as a horizontal snap row, with "p. N · K en esta página" and a "Chat · N" button. Tapping a highlight scrolls the strip to its card; tapping a question opens the chat as a bottom sheet scrolled to it. A note opens in its own bottom sheet.
- **Practice in detail** (`client/practice/practice-view.tsx`, step 9).
  - **The notebook** is the same `Thread` as Read's chat panel, full width. An anchored question's citation is a button.
  - **The drawer.** A citation opens its PDF page in a shadcn `sheet`: from the right on a tablet or desktop (up to 640 px wide), from the bottom on a phone (92% of the screen). It draws the file with the same `PdfPages` as Read, inside its own `SCROLLER`, so `revealAnchor` and the highlights work unchanged; the drawer (`practice/citation-drawer.tsx`) and pdf.js load only when a citation is first opened, so Practice's first load stays small. The drawer opens at the cited page, then, once that page's text layer is drawn, jumps to centre the passage and flashes it. The cited passage stays painted as the active one, and the file's other passages are painted as in Read. Its header shows "apunte.pdf · p. N de M" and "Abrir en Leer", which opens Read there. The drawer is for reading; selecting text in it offers nothing.
  - **Notes** have no place in the thread's order, so the notebook doesn't list them. The drawer paints them on the page (underlined), as Read does.
  - **Quotes.** A quote that appears twice on a page highlights its first occurrence, as in Read.
- **Printing** (`client/print/`, step 12). A session prints as a document with the browser's own print, whichever view is open: "Imprimir" in the header (from a tablet up; a phone's header has no room for it), or ⌘P / Ctrl+P, which it intercepts.
  - **The copy.** Printing mounts a print-only copy of the session in a portal on `<body>`: the title, course and date, then every turn (the question with its citation and photos, then the answer's text; no thinking, tools or controls), then the notes, which the notebook doesn't list. In print media it is the only thing on the page; on screen it is laid out out of sight at the page's width (A4 less the margins), so it draws and measures at the size it prints. It unmounts on `afterprint`. Read's PDF never prints.
  - **Drawn before printing.** `usePrint` waits until nothing in the copy is still loading (the Markdown chunk, each diagram, a Vega chart, the photos, the fonts; at most 20 s), then zooms whatever is wider than the column (a proof tree, a display formula, a table, a diagram) down to fit, then calls `window.print()`. The zoom is measured at A4's column; a narrower page or wider margins chosen in the dialog can still cut a zoomed block. A print it can't intercept (the browser's menu) mounts the copy on `beforeprint` and prints what has drawn; a block still drawing prints its source.
  - **Light on paper.** The dark variant applies only on screen, so print uses the light tokens. Mermaid and Vega bake colours into their SVG, so the copy renders them in the light scheme (`SchemeOverride`), reading light tokens from a `.theme-light` element.
  - **Page breaks.** A question stays whole and with the start of its answer; a diagram, a display formula, a table row and a photo are never split; a heading or the line before a diagram stays with what follows.
- **In the transcript,** entries sit under the exact headings `## Tú`, `## Claude` (or `## Claude *(interrumpida)*`, `## Claude *(error)*`) and `## Nota`. A line in an answer that reads exactly like one of them is written with a leading `\`. An anchor is a blockquote at the top of the question, `> [apunte.pdf, p. 3](../../<course>/materials/apunte.pdf#page=3)` followed by the quoted lines. A note is a `> [!note] <link>` blockquote with the quote nested (`> > …`) and the note's text after it. Session files always sit two folders deep, so the `../../` links open in any editor.
- **An answer's parts.** Under `## Claude` the answer keeps its blocks in the order they streamed, separated by blank lines, so the panel shows the same thread before and after a restart:
  - text as Markdown;
  - a thinking summary as a folded Obsidian-style callout, `> [!thinking]- Pensó` and the summary quoted below it;
  - a tool call as a `> [!tool] <name>` callout, then its input as one line of compact JSON, then `> ✓ <first line of the result>` or `> ✗ …` (no result line if the turn stopped before it came back).

  An answer line that would read as the first line of either callout is escaped with `\` like a heading. Answers written before step 8 parse as a single text part. `partsOf` turns streamed blocks into parts: empty thinking is dropped, adjacent text blocks are joined, and tool fields become single lines, so the format round-trips exactly.

## Installable app

Step 13. The desktop client is the web client installed from Chrome ("Install app"): its own window and Dock icon, on the origin it was installed from.
- **Manifest and worker.** `vite-plugin-pwa` (Workbox `generateSW`) writes `manifest.webmanifest` and `sw.js` into the build; the stack ships it, and a hand-written worker would re-implement the precache list, revisioning and cleanup. The icons are SVG sources in `client/icons/`, rendered to the PNGs in `client/public/` by `bun src/client/icons/render.ts`.
- **What the worker holds.** The precache is the app shell: `index.html`, every hashed bundle (the lazy renderers too, about 11 MB, so a page on an old build keeps working until it reloads), the CSS, fonts, icons and the manifest. Not the diagram fixture page. It has no runtime routes: `/api/*`, `/files/*`, `/pair/*` and `/ws` (which never passes through a worker) go to the network untouched and nothing from them is stored, so it never serves stale data. Navigations to `/` and `/s/<id>` get the cached shell; any other navigation goes to the server.
- **Registering.** `main.tsx` imports `client/pwa/register.ts` (its own chunk, with Workbox's window helper) after `load`, only in a secure context and only in the production build. The first load grows by 0.5 kB.
- **Updates.** A new build's worker installs beside the running one and waits (`registerType: "prompt"`). The page then shows "Hay una versión nueva de Lemma · Actualizar" (`client/pwa/update-pill.tsx`, mounted from the lazy chunk); pressing it activates the new worker and reloads. It asks instead of reloading because a reload would drop a message being typed. A window that never presses it keeps the old build, whose bundles stay precached, until every window of the app closes; the next open gets the new build. The browser checks for a new worker on every navigation; the page also checks when the server answers again after being down (it restarts after a build) and when the window comes back into view.
- **Server down.** With the server stopped, the app still opens from the cache. Its first request fails with a network error, and the app shows "Lemma no está corriendo" (how to start it), asks again every 2 s, and starts over on its own when the server answers. A window that was already open shows the reconnecting pill and resubscribes, as before.
- **The phone gets no worker.** Plain HTTP on a LAN address is not a secure context, so there is no service worker and no install there; the page loads exactly as before. `http://127.0.0.1:<port>` and `http://localhost:<port>` are secure contexts, so the desktop installs over plain HTTP.
- **Pairing in the app window.** An installed app shares the Chrome profile's cookies, so the startup link, which opens in a normal tab, pairs the app window too.
- **The port is part of the app.** The installed app is bound to its origin, `http://127.0.0.1:<port>`, and the device cookie is `lemma-<port>`. If the port changes (`PORT`, or `port` in `config.json`), the installed app keeps opening the old origin and shows "Lemma no está corriendo"; open the new pairing link and install again from it, then remove the old app. Keep the port fixed to avoid this.

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

- **Transcripts.** One `.md` per session, headings and anchors as in Views → In the transcript. An answer keeps its thinking and tool calls as callouts, readable in any editor and folded in Obsidian:

  ```md
  ## Tú

  > [apunte.pdf, p. 3](../../analisis/materials/apunte.pdf#page=3)
  > Teorema 3. Toda sucesión convergente es acotada.

  explicá esto

  ## Claude

  > [!thinking]- Pensó
  > Tomo ε = 1 en la definición de límite.

  > [!tool] Read
  > {"file_path":"analisis/materials/apunte.pdf","pages":"3"}
  > ✓ PDF file read: 1 page

  Sea $(a_n)$ convergente a $L$…

  ## Nota

  > [!note] [apunte.pdf, p. 3](../../analisis/materials/apunte.pdf#page=3)
  > > Demostración. Tomemos ε = 1
  >
  > repasar para el parcial
  ```
- **Photos.**
  - The phone downscales each photo to JPEG with a long edge of at most 2048 px in a canvas before upload (`client/photos/downscale.ts`: `createImageBitmap` with the EXIF orientation applied, an `<img>` fallback, quality 0.85 then lower until it is under 3 MB). This avoids HEIC files and a native image library on the server.
  - An upload waits in the session's folder (`<session>/001-photo.jpg`, numbered, never overwritten) and in the session state, so every client sees it in the composer, wherever it was taken, and a restart finds it again: a photo in the folder that no `## Tú` links yet is still waiting.
  - The next user message takes the waiting photos. The server sends each to Claude as a base64 `image` block before the text, and the text gets a `<photos>` block with their paths in the study folder.
  - The `.md` links each one as a normal Markdown image, after the question's text: `![Foto](../../<course>/sessions/<session>/001-photo.jpg)`. Only trailing `![Foto](../../…)` lines parse back as photos.
  - Rejected: B's "Claude `Read`s the path". It costs a tool round trip on every photo.
- **External edits.** A `folder` event makes an open PDF or note pane show a "changed on disk" chip. The app never edits notes; Claude's `Edit` tool already refuses to edit a file that changed after it was read.

## Security

- **Network and auth.**
  - The server binds `127.0.0.1`, and LAN mode is on only while a phone is paired (a device redeemed from a LAN code, `lan: true` in `devices.json`) or a phone's code is waiting. LAN mode is a second `Bun.serve` on the same port bound to the LAN address only (`server/lan.ts`: the first private IPv4, Wi-Fi or Ethernet first, never `0.0.0.0`, a VPN or Tailscale address, or a Docker or VM bridge; `LEMMA_LAN_ADDRESS` overrides it, which tests set to `::1`). `server.publish` goes to both listeners, since topics are per server. Revoking the last phone stops the listener and drops the LAN origin from the allow-lists.
  - **Every request needs a device cookie, loopback included**, so another local process can't drive an agent that writes files. `bun run start` prints and opens a one-time `/pair/<code>` URL for the desktop. The phone pairs by QR code.
  - Codes are 128-bit, single use and expire after 5 minutes. They live in memory only, so a restart forgets them. Tokens are 256-bit, stored as an `HttpOnly; SameSite=Strict; Path=/` cookie for 400 days, and only their SHA-256 is kept on the server, in `devices.json` (mode 0600, written atomically). A `devices.json` that doesn't parse stops the server rather than pairing nobody.
  - The cookie is named `lemma-<port>`: cookies are per host, not per port, so two servers on `127.0.0.1` (the two e2e servers, say) must not share one.
  - The `Host` header is checked against an allow-list on every request, static files included (this blocks DNS rebinding): `127.0.0.1:<port>` and `localhost:<port>`, plus `<lan-ip>:<port>` in LAN mode.
  - `Origin`, when a request carries one, must be `http://127.0.0.1:<port>` or `http://localhost:<port>` (or `http://<lan-ip>:<port>` in LAN mode); there is no CORS, and no GET changes state; that covers POST, PATCH, DELETE and WebSocket upgrades, where browsers always send it. A request without `Origin` comes from a non-browser client, which still needs the cookie, so `curl` with the cookie works.
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
  - The production server sends a Content-Security-Policy with every page (`CSP` in `server/http.ts`): scripts only from our bundle (plus `'wasm-unsafe-eval'` for Graphviz), `connect-src 'self'`, no objects, frames or `<base>`. It backs up the sanitizer; e2e/blocks.pw.ts and e2e/read.pw.ts fail on any violation.
  - Step 13 changed nothing in the policy either: the service worker is a same-origin script (`worker-src 'self'`), Workbox's runtime comes from `importScripts` of our own file (`script-src 'self'`), and the manifest falls back to `default-src 'self'`. The shell the worker returns from its cache keeps the response headers it was fetched with, CSP included. The worker's scope is `/`, but it answers only navigations to the app's pages and precached files (Installable app).
  - Step 10 changed nothing in the policy: photo previews are `blob:` URLs and thumbnails are `/files/` URLs, which `img-src 'self' data: blob:` already allowed, and the QR code is inline SVG drawn by React.
  - The pdf.js worker is a module file in our bundle (`worker-src 'self'`), and pdf.js reads the PDF over `connect-src 'self'`, so step 8 added nothing to the policy. zod's parser compiler probes `new Function`, which the policy refuses and reports, so the client runs zod with `jitless` (`client/zod-config.ts`).
  - Each source is size-capped. Graphviz and Vega still run on the main thread, so a hostile block under the caps can stall the tab; accepted for a single-user local app.
- **Accepted risk.** On the LAN, a cookie sent over plain HTTP can be sniffed. This is documented, and Tailscale Serve is the hardened option. Over plain HTTP the phone's page is not a secure context, so the client must not use APIs only secure contexts have (`crypto.randomUUID` broke the first phone upload; `client/random-id.ts` uses `getRandomValues`).

## Stack

- **Server.** Bun, with no framework, about 15 routes.
- **Client.** React 19, bundled by Vite (`root: src/client`).
  - UI is shadcn/ui on Base UI with Tailwind 4. Components are copied into `src/client/components/ui` with `bunx --bun shadcn add` and are ours to edit. AI Elements patterns (Message, Message Scroller, Trace, Code Block, Prompt Input) are built from those components and fed by our reducer, not by the AI SDK.
  - The theme in `src/client/globals.css` maps the prototype's tokens onto shadcn's variable names. Dark mode follows the system unless `<html data-theme>` overrides it.
  - Fonts (Inter, Source Serif 4) are self-hosted from `@fontsource-variable`, so the app works offline.
  - Lazy-loaded chunks: the Markdown renderer (react-markdown, KaTeX and the block dispatcher, `client/markdown/lazy.tsx`), then one chunk per block renderer (`client/blocks/`: viz.js, our `proof`, `fitch` and `plot`, Vega, Mermaid). Step 6 took the first load from 941 kB of JavaScript to about 500 kB; an e2e test holds it under 570 kB. The PWA is a manifest plus a service worker that caches only the app shell (Installable app).
- **Commands.**
  - `bun run dev`: the Vite dev server (port 5173, with React Fast Refresh) and the Bun server (port 4317) side by side. Vite forwards `/api`, `/files`, the `/pair` POST and `/ws` to Bun without rewriting `Host` or `Origin`, so the server's own checks still apply, and the server allows the dev origin only in dev. The server prints a pairing link on the Vite origin on every start, and opens it only while no device is paired, since `bun --watch` restarts it on every save.
  - `bun run build`: `vite build`, which bundles the client to `dist/`.
  - `bun run start`: serve `dist/`, `/api` and `/ws` on one port, then print and open the pairing link. `LEMMA_OPEN=0` keeps it from opening a browser (tests, CI).
- **Tests.**
  - `bun test`: the reducer, `normalizeMath`, open-fence detection in Markdown, the `plot` expression parser (known values; `constructor`, unknown names and deep nesting rejected), the prompt listing exactly what the renderers accept, the transcript round trip, `calc` (known values; `import`, `eval` and loops rejected), the path jail (symlink escapes), `lanAddress`, and auth.
  - Auth (`src/server/auth/auth.test.ts`): a 403 for no token on every route, a foreign Host, a foreign Origin (WebSocket upgrades too), a reused or expired code, a revoked token, the gated first-run `POST /api/folder`, the dev origin outside dev, and LAN mode (the LAN origin allowed only while it is on, a LAN code making a `lan` device).
  - Integration with the fake driver: two clients receive identical events, a client joining mid-stream gets the snapshot plus the tail, an epoch change after restart, the reseed when the hash differs, and a 403 after a device is revoked.
  - Integration for the phone (`src/server/phone.test.ts`, LAN address `::1`): pairing over the LAN starts the listener; an upload reaches every subscribed client (the phone's socket on the LAN listener too), then the next message carries it to Claude as an image and the `.md` links it; a foreign Origin, no cookie, a non-image, an oversized body and a JSON body are refused; a revoked phone gets 403 and the listener stops; a photo with no session goes to `inbox/`.
  - Integration for Read (`src/server/read.test.ts`): `/files/*` answers a Range with 206 and exactly those bytes, and refuses paths outside the folder, symlinks out and hidden files; notes land as `> [!note]` and reach Claude with the next message; an anchored question reaches Claude with its passage; thinking and tool rows survive a restart.
  - Playwright on the production build: streamed math with zero `.katex-error`, the diagram fixture page (`/fixtures/blocks.html`, a second Vite entry: one valid and one broken block of each kind, a block still streaming in, and link and click injection probes), a recorded answer with diagrams that never shows an error mid-stream, Read (`e2e/read.pw.ts`, on a PDF written by `e2e/pdf.ts`: select on page 3 then Ask sends `page: 3`, a note shows as a card and in the `.md`, ⌥1/⌥2, the phone strip and sheet), and photos (`e2e/photos.pw.ts`, a 390 px touch context: the camera input, a 4032×3024 JPEG stored at 2048×1536, the photo in a second context, sent with the next message, removed from every client, and the disabled "Leer" explained by a tap). It runs the server with `LEMMA_FAKE=1`, which swaps in `FakeDriver`: messages replay `math-rich.jsonl` unless they end in a `<!--fixture:<name>-->` paragraph, and `LEMMA_FAKE_DELAY_MS` paces each SDK message. The same mode serves for trying the UI offline. `FakeDriver` saves a session once a turn reaches its `result`, like the SDK, so sharing one driver between two servers models a restart. `bun run test:e2e` builds first, then runs two servers on empty folders under `.e2e/`: one with a study folder and one at the first-run screen. Before each starts, `e2e/seed-device.ts` pairs one device through the `auth` module and leaves its cookie for `e2e/fixtures.ts`, so every test's browser starts paired; `unpaired(browser)` gives a context without it.
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
- Bun's HTML imports for the client, tried in step 0. They work, but shadcn has no setup for them, the CLI build needs a custom script to run Tailwind, and Bun 1.4.4's CSS parser rejects some Tailwind output (`@supports (content: counter(line) / "")`, from shadcn's Code Block). Vite has first-class shadcn and Tailwind support and settled paths for the pdf.js worker and the PWA.
- Workspaces.
- An agent worker process.
- A permission-prompt UI in v1, which would need a cross-client approval protocol.
- `sharp`.
- chokidar.
- A Docker sandbox for `calc`.
- One `query()` per turn, which loses interrupt and queuing and respawns `claude` every turn.
