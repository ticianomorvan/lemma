# Lemma

A study environment where math comes first. Read your course material, ask Claude about a passage, and work exercises with feedback. Answers render LaTeX, plots, proof trees and automata properly. You can send photos of handwritten work from your phone.

It runs on your own computer. Your notes, sessions and photos stay as plain files in a folder you own.

> Status: planning. Nothing to install yet. See [docs/plan.md](docs/plan.md).

## How it works

- **One local server** (Bun) holds everything. Any browser window, including the installed desktop app or your phone, is a client that shows the same live session.
- **Two views of one session.**
  - **Read:** the course page with Claude's answers in the margin, or the full chat beside it.
  - **Practice:** the session as a notebook for working exercises.
- **Claude** runs through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), with read and write access limited to your study folder.

Read more in [docs/spec.md](docs/spec.md) and [docs/architecture.md](docs/architecture.md). There is also a clickable [UI prototype](prototype/workspace.html): open it in a browser.

## Development

Needs [Bun](https://bun.sh) 1.4.

```sh
bun install
bun run dev      # http://127.0.0.1:5173: Vite (client) plus the Bun server (API, port 4317)
bun run build    # vite build: bundle the client to dist/
bun run start    # serve dist/ (set PORT to change the port)
bun run check    # typecheck, Biome, bun test, Playwright on the production build
```

Playwright needs Chromium once: `bunx playwright install chromium`.

On first run Lemma asks for your study folder and remembers it in `~/Library/Application Support/lemma/config.json`. Each top-level folder in it is a course, and each session is a Markdown file in `<course>/sessions/`. `LEMMA_STUDY_DIR` overrides the folder for one run.

## Installing the desktop app

With `bun run start` running, open Lemma in Chrome and choose **Install Lemma** (the install icon in the address bar, or ⋮ → Cast, save and share → Install page as app). It opens in its own window with its own Dock icon. When the server is stopped the window says so and reconnects by itself once you start it again; after a new build it offers "Actualizar".

The app is tied to its address, `http://127.0.0.1:4317`: keep the port fixed. If you change it, install again from the new address. A phone over the local network gets the same page but no install, since plain HTTP on a LAN address isn't a secure context.

## Signing in to Claude

Lemma never asks for, reads or stores your Claude credentials. It runs the official, unmodified Claude Code program, and you sign in to that yourself in one of two ways:

- **Your Claude subscription:** run `claude /login` once in a terminal, or
- **Your own API key:** set `ANTHROPIC_API_KEY` (Amazon Bedrock and Google Vertex variables work too).

Your usage is billed to your own account under Anthropic's terms. See Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) for what each option allows.

## License

[MIT](LICENSE)
