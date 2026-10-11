# shared/ (pure logic, no AI)
- `rules.ts`: exact best-XI search, Dream11 validator, fix suggestions.
- `reasons.ts`: rejects generic reasons like "in good form".
- `names.ts`, `weights.ts`, `types.ts`: name matching, default scoring weights and rules, shared types.
Used by both the server (to build the team) and the browser (to re-validate overrides instantly). Covered by `tests/`.
