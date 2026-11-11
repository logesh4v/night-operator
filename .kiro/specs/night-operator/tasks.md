# Night Operator Tasks

- [x] Six role agents in `.kiro/agents`
- [x] Pipeline with solver, accessibility, safety, schema and human gates
- [x] Rework loop: a failing gate returns work to the responsible role with the reason
- [x] Nova adapter with allowlist, stub-tested live path, deterministic dry-run
- [x] Dry-run proof against LINE 13 solver, integrity, publication gate and web import
- [ ] Live Bedrock run (needs AWS credentials and an explicit opt-in; not done in this build)
- [ ] Audio assets: LINE 13 Milestone 5 adds Polly voices; the Stage Director then may use the `sound` channel
- [ ] Optional: Bedrock Guardrails as a semantic layer in the safety gate
