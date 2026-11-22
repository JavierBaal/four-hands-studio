# Instructions for coding agents

Four Hands Studio is largely written with AI coding agents. These are the rules for any agent (and any human) working in this repository.

## Read first

- [docs/architecture.md](docs/architecture.md) before touching code.
- [docs/design.md](docs/design.md) before touching anything visual, and compare with screenshots of the running app.
- [docs/piano-roll.md](docs/piano-roll.md) for gestures and shortcuts; [docs/mcp.md](docs/mcp.md) for the AI's tools; [docs/audio-engine.md](docs/audio-engine.md) for `engine/`.

## Code rules

- **TypeScript strict.** Identifiers and comments in English; interface texts in `packages/desktop/src/shared/i18n.ts`, in Spanish and English. Documentation in English (the README also has a Spanish version: keep both in step).
- **The core (`packages/core`) is pure:** no interface, files, network or Electron. Every change to the song is a command with its inverses; a transaction is one undo step.
- **Ticks never leave the core** (960 per quarter note). The deviation from the grid is computed when reading, never stored.
- **MCP tools are defined only in `packages/mcp-tools`.** No tool composes: they read, write, analyze and transform mechanically. Answers are compact text only, without `structuredContent` (docs/architecture.md, 6.2). A change to the tools raises `TOOLS_VERSION` and the bridge's version.
- **Every product rule has its test** (authorship, deviation when moving, conflicts, proposals). `npm run check` must pass before anything is committed.
- **Licences:** only MIT, Apache, BSD, ISC or OFL dependencies in the app, the bridge and the core. The engine is AGPLv3 because of JUCE; nothing in `packages/` may depend on engine code.
- **Comments say why.** When citing a document, use `docs/<name>.md, <section>`; the numbering of those documents is stable.

## Visual changes

Nothing visual changes silently. Propose a visual change with before and after screenshots, follow the tokens and measurements of docs/design.md, and update that document when the design changes.

## Testing

- `npm run check`: type checks and unit tests.
- `npm run arranque` and `npm run puente`: the real Electron app (with `xvfb-run` on Linux).
- The engine: CMake build plus `--selftest` (see [BUILDING.md](BUILDING.md)). The project is developed on Windows; say on which system you tested.
