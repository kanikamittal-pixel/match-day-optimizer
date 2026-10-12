# shared/ (pure logic, no network)
Used by the server (to build the team) and the browser (to re-check changes instantly). Covered by `tests/`.
- `rules.ts`: exact best-XI search, Dream11 validator, fix suggestions. `dream11.ts`: what Dream11 allows, and the check for Settings.
- `scoring.ts`: the Dream11 T20 points table. `form.ts`: expected-points base from history. `weights.ts`: default rules and weights.
- `matchreport.ts`, `backtest.ts`, `stats.ts`: the one-match report, back-test analysis, and statistics.
- `names.ts`, `squad.ts`, `reasons.ts`, `budget.ts`, `when.ts`, `types.ts`: name matching, squad readiness, generic-reason filter, API budget rule, date labels, shared types.
