# Night Operator Product Steering

Night Operator is the build-time content factory for LINE 13. It is not a game, a chat bot, or a general story generator.

## Promise
Given a short brief, produce one LINE 13 episode manifest that LINE 13 imports with no manual repair, has exactly one solution, and carries a full no-audio, reduced-motion and captioned path.

## Rules that never bend
- The LINE 13 episode contract (`contracts/episode.schema.json`) is the only output format. Never loosen it, never add fields. Private material (premise, backstory) stays in `story-bible.md`.
- LINE 13's own solver (`packages/graph`) decides solvability. Night Operator adds no solver of its own and never marks an ambiguous draft verified.
- A gate failure goes back to the role that owns the failing part, with the reason. Gates never patch content themselves.
- The human review gate is a person. The pipeline never writes its own approval.
- Dry-run is the default. Output is deterministic: same brief and fixtures give a byte-identical manifest.
- Read-only on `/Users/logesh/.kiro/crew/workspace/line-13`. Never write there.

## Tone
Atmospheric, uncanny, restrained. No gore, no real people, no brands, no contact details. Reading grade 8 or lower.
