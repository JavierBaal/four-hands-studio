# Skills

Skills are short pieces of written craft that the AI loads while composing in Four Hands Studio: how to work in a shared score, how to turn feelings into musical decisions, orchestration, styles, reviewing its own work, mixing. They are plain Markdown (`SKILL.md`, plus optional reference files) in the [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) format.

**The app serves them.** Every folder here with a `SKILL.md` travels inside Four Hands, and the AI reads them through two MCP tools: `list_skills` (names and descriptions) and `load_skill` (a skill's instructions, or one of its reference files). The server instructions ask the AI to load `four-hands-basics` at the start of every conversation and the rest when they fit the request. Nothing has to be installed in Claude.

They are written in English, the language models follow best, with examples in Spanish and English because users ask in their own language.

| Skill | What for |
|---|---|
| [`four-hands-basics`](four-hands-basics/SKILL.md) | How to work in Four Hands: the working loop, the song's concept and its limits, short sketches before whole pieces, small interventions, iterating instead of rewriting, respecting what the user played, reviewing and reporting honestly |
| [`feelings-to-music`](feelings-to-music/SKILL.md) | Understanding any user, whatever their vocabulary: reflecting the request in one sentence, asking by contrast, a translation table from sensations to musical decisions, from references to technique |
| [`listening-review`](listening-review/SKILL.md) | Reviewing what was written before handing it back, with `analyze`: mud in the bass, a crowded midrange, copied blocks, ramp dynamics, clichés, the song's limits |
| [`orchestration-register`](orchestration-register/SKILL.md) | Layers and registers, low-interval limits, voice spacing, doubling and the comfortable range of each instrument |
| [`styles`](styles/SKILL.md) | An atlas of styles (experimental title sequences, cinematic and hybrid, dark synth…): what defines each, typical moves and the clichés that pull it towards a neighbouring genre |
| [`mixing`](mixing/SKILL.md) | Mixing and mastering by measuring, not guessing, with `analyze_mix` and Four Hands' own effects or the user's plugins |
| [`sample-libraries`](sample-libraries/SKILL.md) | Working with sampled instruments in plugins (Kontakt and similar): velocity, CC11, CC1, range and keyswitches, and the library card |
| [`jury`](jury/SKILL.md) | Three judges (craft, brief, destination) assess a finished piece with scores, a verdict and the three changes that matter most. Only on request ("call the jury") |

## Your own skills

Put a folder with a `SKILL.md` in `Documents/Four Hands/Skills`, or import a ZIP from *Settings > Your AI*. It appears at once, without restarting. If it has the same name as a built-in one, yours wins. Each skill can be turned on and off.

## Using them outside Four Hands

Any client that supports Agent Skills can use these folders as they are (zip a folder and upload it, for example in Claude's *Customize > Skills*). Inside Four Hands this is not needed: if they are installed in Claude as well, remove them there so there are not two copies.

## Contributing a skill

Good skills are short, concrete and testable in a real session: the craft, the moves and the mistakes to avoid, not a manual. Write the `description` so the AI knows exactly when to load it. Try it composing a few pieces with and without it, and say in the pull request what changed.
