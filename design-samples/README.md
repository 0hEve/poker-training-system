# Hand-drawn art direction — design exploration

Two designers got the same brief: hand-drawn, 3D-like casino chips and playing cards
that follow standard layouts. They worked in parallel. Each built parametric SVG
generators (`elements.js`), a showcase page (`sample.html`) and a screenshot
(`preview.png`).

| Folder | Designer (revealed after review) |
| --- | --- |
| `candidate-q/` | GPT-6.2 Sol (medium effort) |
| `candidate-m/` | Claude Opus 5.5 (medium effort) |

## Council review (blind, one round)

Two reviewers scored both candidates without being told who made which.

| Reviewer | Candidate Q | Candidate M | Pick |
| --- | --- | --- | --- |
| Claude Opus 5.5 (low) | 7/10 | 8/10 | M |
| GPT-6.2 Sol (low) | 8.3/10 | 8.7/10 | M |

**Outcome:** both reviewers picked candidate M (Opus 5.5). It became the visual basis
of the app, and all later art work used only that agent system.
Main reasons: real cylindrical chip stacks, card thickness, legibility proven at
in-game size (70px cards, 40px chips), distinct J/Q/K court figures, and shared
defs/memoised generators.

Polish requested for the production port (`src/art/`): a warmer, muted palette
and oxblood card back taken from Q, a stronger sketch line at large sizes, a 1 chip
that reads clearly white at 40px, engraved hatching on the ace and court figures,
and larger corner indices.
