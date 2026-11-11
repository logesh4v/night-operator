# Night Operator Requirements

Author: S Logesh. Companion to LINE 13 Milestone 6.

## N1 Roles
1. Six role agents exist as Kiro agents in `.kiro/agents`: Folklorist, Puzzle Architect, Solver, Stage Director, Accessibility Examiner, Packager.
2. Each model-calling role takes its prompt from its agent file, so the Kiro agent and the Nova call cannot diverge.

## N2 Gates
1. Solver gate: LINE 13's `computeProofReport` must return `verified` with exactly one solution, an exhaustive recovery sweep and no unreachable node.
2. Accessibility gate: captions on every caller, a silent path for every ring, voice and haptic cue, reduced-motion alternatives, flicker cap, reading grade 8 or lower.
3. Safety gate: lexical content floor plus the AWS-only name check.
4. Schema gate: `episode.schema.json`, LINE 13's `validateEpisodeManifest`, cue/reference sanity, integrity hash, fresh solver run matching the embedded proof.
5. Human gate: a named reviewer, a safety flag, and the exact manifest hash reviewed.
6. A failing gate returns the work to the responsible role with the reason, at most 3 attempts per role, then fails closed.

## N3 Models
1. Only Amazon Nova via Bedrock, behind an adapter.
2. A deterministic offline dry-run replays fixtures with zero AWS calls and is the default.
3. The live path is implemented and tested with a stub; it is never exercised by tests.

## N4 Correctness invariant
The output imports into LINE 13 with no manual repair: it passes LINE 13's contract validator, solver (exactly one solution), manifest integrity check, publication gate and web import path.
