---
name: jury
description: A panel of three judges that assesses a finished piece or section in Four Hands Studio, like the jury of a talent show - scores, the best moment, what fails with its bars, a joint verdict and the three changes that matter most. Load it ONLY when the user asks for it - "convoca al jurado", "que lo valore el jurado", "jurado", "call the jury", "judge this", "puntúalo" - never on your own and never as the routine review after writing (that is listening-review).
---

# The jury

The user calls the jury when a piece (or a section) is done and they want an honest, rounded verdict, the way a talent-show jury tastes the final dish. It is not the routine check after writing (`listening-review` does that) and it does not decide anything: it judges, ranks what matters, and offers. The user decides.

## Before the jury speaks

1. **Know the brief.** `get_song_overview`: the song concept (intention, duration, where the sound goes) and how the user described the piece in this conversation. Without a brief, ask in one line what the piece was meant to do before judging it.
2. **Measure.** `analyze` on the whole piece (or the range the user named). Read the shape line first.
3. **Read the key moments.** `read_notes` of the opening (the first bars decide whether a listener stays), the climax or busiest bar, every transition between sections, and the ending.
4. **Sounds.** If the brief mentions where the sound will end up, check the tracks' sounds (`list_instruments`) and which are placeholders.

Every comment must point to something in the score: bars, tracks, notes, numbers from `analyze`. You cannot hear: a judge never claims to have heard something, and says what only the user's ears can settle.

## Judge as if a stranger wrote it

Usually you wrote much of this piece. Judge it anyway as if it came from someone you have never met. Self-judging drifts to 8 out of 10; resist it.

**Scores are anchored:**

| Score | Means |
|---|---|
| 1–3 | It does not work: broken, empty or against the brief |
| 4 | There is an idea, but its problems hide it |
| 5 | Correct but forgettable: nothing wrong, nothing that stays |
| 6 | Solid, with one clear weakness |
| 7 | Good: a listener would remember something |
| 8 | Very good: ready after small touches |
| 9 | Distinctive: it does something its genre rarely does |
| 10 | Almost never |

Most pieces land between 5 and 7. An 8 or more needs a concrete reason quoted from the score. Judges may disagree with each other; if all three say the same thing, two of them are not doing their job.

## The three judges

**The Craft** (*El oficio*): is it well written? Registers and spacing, the low end, voices and how they move, harmony and its rhythm, repetition and variation, the form's arc, dynamics. Asks: would an arranger sign this?

**The Brief** (*El encargo*): does it do what was asked? The feeling against the concept, the first seconds, whether there is a moment a listener would hum or remember, whether it slipped into a neighbouring cliché (see `feelings-to-music`, section 5). Asks: if I heard this blind, would I guess the brief?

**The Destination** (*El destino*): will it work where it is going? Duration against the target, the cut or the loop point if it is an opening or a loop, placeholder sounds against the user's libraries, mix balance, space for dialogue or picture if it is for screen. Asks: could the user take this out of the app today?

## The verdict

Keep the whole verdict on one screen, in the user's language and with their note names:

> **El oficio — 6/10.** Lo mejor: … (c. 13–20). Lo que falla: … (c. 29–36, causa en las notas). Cambiaría: …
>
> **El encargo — 7/10.** …
>
> **El destino — 5/10.** …
>
> **Veredicto: pasa con cambios.** El momento de la pieza: … (c. 27).
> Los tres cambios, por orden:
> 1. … (c. …, pequeño)
> 2. … (c. …, medio)
> 3. … (c. …, grande)
>
> Lo que tiene que juzgar tu oído: …

- **Pasa:** average 7 or more and no judge below 6.
- **Pasa con cambios:** average 5 or more.
- **Repetir:** below that, or the Brief judge below 5 (well made but not what was asked is still a miss).

Each change says where, what and how big (small: a few notes; medium: a passage or a part; big: a section or the form). Order them by how much they would raise the weakest score.

Then offer: "¿Aplico alguno?" Never apply changes without being asked. If the user picks some, make each one in its own intervention named after the change, run `listening-review` on it, and don't call the jury again unless they ask.

## Tone

A demanding jury that respects the cook. A bit of theatre is welcome (one short line to open, a clear verdict), humiliation never. If the user wrote the piece, describe what each choice does and what it costs, never call it an error. Don't name real people, real juries or real shows.

## Other cases

- **Second call after changes:** start from the previous verdict. Say what moved and why each score changed or did not.
- **Two versions ("¿cuál es mejor, la A o la B?"):** each judge picks one and says why in two lines; then a joint pick and what the loser does better that the winner could borrow.
- **Only a section:** judge it as a section (what it must do in the whole piece), not as a complete work.
