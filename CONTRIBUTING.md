# Contributing to Four Hands Studio

Thank you for wanting to help. Four Hands is young and built by one person with Claude, so reports from real use are as valuable as code.

## Ways to help

- **Use it and report what happens.** Especially on **macOS** and with a **hardware MIDI keyboard**, which have not been tested yet. A good report says what you did, what you expected, what happened, your system, and attaches the app's log when it is relevant: `registro-app.jsonl`, in `%APPDATA%\Four Hands Studio` on Windows (`~/Library/Application Support/Four Hands Studio` on macOS).
- **Compose with it and tell us how the AI did.** What it understood, where it went wrong, which skill would have helped. That feeds the [skills](skills/README.md).
- **Fix bugs and build features.** Open an issue first for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
- **Translate.** The interface is in Spanish and English (`packages/desktop/src/shared/i18n.ts`); more languages are welcome.

## Before you write code

Read [docs/architecture.md](docs/architecture.md). The few rules that matter most:

- **The core (`packages/core`) is pure:** no interface, files, network or Electron. Every change to the song is a command with its inverses; a transaction is one undo step.
- **Ticks never leave the core** (960 per quarter note). The deviation from the grid is computed when reading, never stored.
- **MCP tools are defined only in `packages/mcp-tools`.** No tool composes: they read, write, analyze and transform mechanically. Answers are compact text only.
- **Every product rule has its test** (authorship, deviation when moving, conflicts, proposals).
- **The interface follows [docs/design.md](docs/design.md).** A visual change comes with before and after screenshots.
- **Gestures and shortcuts follow [docs/piano-roll.md](docs/piano-roll.md).**
- **Dependencies:** permissive licences only (MIT, Apache, BSD, ISC, OFL) in the app, the bridge and the core.

## Code style

- TypeScript strict. Identifiers and comments in English; interface texts in the language files, in Spanish and English.
- Comments explain **why**, not what. When a comment cites a document, it uses `docs/<name>.md, <section>`.
- Keep changes focused: one pull request, one purpose.

## Pull requests

1. Fork, create a branch from `main`, make your change.
2. Run `npm run check` (type checks and tests). It must pass.
3. If you touched the interface, attach screenshots. If you touched the engine, say on which system you built and tested it.
4. Describe what changed and why, and how you tested it.

By contributing, you agree that your contribution is licensed under the licence of the part of the repository it touches: MIT for everything except `engine/`, which is AGPLv3.

## Working with an AI

Much of Four Hands was written with Claude, and contributions made with AI assistants are welcome. You are responsible for what you submit: read it, test it and be able to explain it. Instructions for coding agents are in [AGENTS.md](AGENTS.md).

## Conduct

Be kind and specific. See the [Code of Conduct](CODE_OF_CONDUCT.md).
