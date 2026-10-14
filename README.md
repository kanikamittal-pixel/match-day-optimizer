# Match Day Optimizer

A Dream11 match-day tool for one owner, Aryan. It builds a valid team for each match, explains every pick in one line, and then checks itself against the real result. **Aryan always has the final say**; the app never submits a team for him.

**Live app:** https://match-day-optimizer.vercel.app · **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Components Map:** [docs/components-map.png](docs/components-map.png)

Stack: Next.js 15 + TypeScript on Vercel · Supabase (Postgres) · Gemini Flash (the only AI, called through OpenRouter) · CricketData.org and RapidAPI (Cricbuzz) for fixtures and scorecards · Cricsheet (open ball-by-ball data) for fantasy history.

## Repository layout

| Folder | What is in it |
|---|---|
| [`frontend/`](frontend) | Everything in the browser: screens (`pages/`), components, styles. Never touches a secret. |
| [`backend/`](backend) | Everything on the server: API routes, services, integrations (one file per outside service), scripts. |
| [`shared/`](shared) | Pure logic used by both: rules engine, scoring table, expected-points base, report maths. No network, no AI. |
| [`supabase/`](supabase) | Database schema (SQL migrations). |
| [`tests/`](tests) | Unit tests (`npm test`). |
| [`docs/`](docs) | Architecture and the Components Map. |
| [`app/`](app) | Next.js routing only: one-line files that point to `frontend/` and `backend/`. |

## What it does

- **Dashboard:** next match with a countdown, switch to any upcoming match, "Players to watch" with form, and a small captain face-off game.
- **Squad and XI:** found automatically by web search (announced XI after the toss, likely XI before). Credits from a Dream11 screenshot are optional.
- **Expected points:** the key number per player (below). Every player gets a reason that must cite something specific to the match.
- **Team builder:** the exact best valid 11 under Dream11's team rules; the rules are re-checked after every change. Missing data stops the build and says what is missing.
- **Team card and decisions:** XI, captain, vice-captain and reasons. Aryan can swap, lock or exclude anyone; the agent explains its view once and never blocks.
- **Match Report (one match):** our team against the real top 11, captain rank, average miss, what was missed and why, and every player's expected vs actual points.
- **Insights (all matches):** Overview charts, back-tests, the decision rubric, data checks, and Aryan-versus-agent. Patterns found here become suggested weight changes.
- **Settings:** Aryan edits team rules (only within what Dream11 allows: team size 11 is fixed), the scoring weights and his own playbook rules. Nothing changes without his approval, and weights are versioned.

## How a player is chosen

| Step | Rule | Source |
|---|---|---|
| Career average | 50% of the base (players with 5+ earlier T20s) | Cricsheet, scored with Dream11's T20 table, since 2018 |
| Recent form | 50% of the base: average of the last 20 matches, newer matches count more (half-life 5) | same |
| 1 to 4 earlier matches | the player's own average mixed with the typical new-player score (about 37 to 41), own average weighted 2 to 1 | measured on about 2,500 cases |
| No history | Gemini's own estimate, labelled on the team card | Gemini |
| Match conditions | Gemini adds or subtracts points, capped at the larger of 10 or 40% of the base: pitch and venue record, weather and dew, opposition, batting position, team news, Aryan's playbook rules, past errors | Gemini + Google Search |
| Which 11 | exact search for the valid team with the highest total expected points: 11 players, WK 1-4, BAT 3-6, AR 1-4, BOWL 3-6, at most 7 from one team by default (Dream11 allows up to 10), 100 credits when known | code, no AI |
| Captain / vice | 2x / 1.5x. Gemini picks; code keeps the captain in the top 3 by expected points and the vice-captain in the top 4 | Gemini, checked by code |
| Final say | Aryan; each override is tagged gut or reasoned | Aryan |

## Back-tests and checks

- **Back-test:** build a team for a match that has already finished using only what was known before it (history cut off before that day, no web search, the real XI), then read the actual points and run an automatic post-mortem. Three finished matches were tested (India v West Indies, India v Pakistan, Bangladesh v Pakistan).
- **Large test:** ideas for fixes were tested on 1,236 past matches with no AI, with 95% confidence ranges and a split into two halves of the year. Three changes were adopted (recency-weighted recent form, a steadier base for new players, a captain safety net) and several were rejected with evidence. The headline: single-match fantasy scores are mostly luck, and the history-based method captures about 76% of the best possible top 11 on average.
- **Data check:** the same players in the same match were scored from two independent sources (Cricsheet and CricketData): 19 players, average difference 1.3 points. The scoring table matches Dream11's own T20 points page (fetched 12 Oct 2026).

## Setup

1. **Supabase:** create a project and run the files in [`supabase/migrations/`](supabase/migrations) in order (`0002_open_access.sql` makes the demo work without a login).
2. **Keys:** copy `.env.example` to `.env.local` and fill it in (never commit it). All variables are server-only.
3. `npm install && npm run dev`, then open http://localhost:3000.
4. **History:** `npm run ingest:cricsheet` loads the fantasy history. A daily Vercel Cron (`vercel.json`, 02:30 UTC, protected by `CRON_SECRET`) keeps it fresh.
5. **Deploy:** push to GitHub, import in Vercel, add the same variables.

| Command | Purpose |
|---|---|
| `npm test` | unit tests (rules engine, scoring, name matching, report, back-test maths) |
| `npm run typecheck` | TypeScript check |
| `npm run backtest -- <match id>` | back-test one finished match |
| `npm run backtest:formulas` | test fixes on 1,000+ past matches |
| `npm run audit:form` | second-source accuracy check |
| `npm run backup` | save every table as JSON in `backups/` (gitignored) |

## Known limits

- Dream11's exact team limits (7 vs 10 per team, role limits) are not on its public points page, so they are unverified against the current app. The role limits and the 100-credit cap can only be tightened in Settings, never loosened.
- Cricsheet publishes a few days late; the newest matches are filled in from CricketData scorecards when its free daily quota allows (15 of the 100 daily calls are reserved for scorecards) and are listed under Insights, Data check as waiting.
- The second-source accuracy check covers one match so far because of that quota.
- No cricket source publishes Dream11 credits, so credits are optional; without them the 100-credit cap is not enforced.
- **Linking players to their history.** Dream11 shows short names ("C Wickra", two players called "K Mendis"), while Cricsheet uses initials ("BKG Mendis"). Once the announced XI is known, its spelled-out names are used to link each player (strict, never a guess), which linked 22 of 22 players for Pakistan v Sri Lanka against 15 of 22 from the short names alone. `npm run repair:names` fixes older top-up rows stored under a different spelling.
- A side Cricsheet does not cover (for example some domestic teams) has no history, and the app says so.
- The AI's pitch and weather adjustment helped in some back-tests and hurt in others; each Match Report shows which.
