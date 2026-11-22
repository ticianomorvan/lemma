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

## Signing in to Claude

Lemma never asks for, reads or stores your Claude credentials. It runs the official, unmodified Claude Code program, and you sign in to that yourself in one of two ways:

- **Your Claude subscription:** run `claude /login` once in a terminal, or
- **Your own API key:** set `ANTHROPIC_API_KEY` (Amazon Bedrock and Google Vertex variables work too).

Your usage is billed to your own account under Anthropic's terms. See Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) for what each option allows.

## License

[MIT](LICENSE)
