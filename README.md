# Match Day Optimizer

A Dream11 match-day tool for one owner (Aryan). It researches the match, builds a team that is valid to submit as-is, explains every pick with match-specific reasoning, and learns by comparing its predictions with what actually happened. **Aryan always has the final say.**

Stack: Next.js 15 (App Router) on Vercel · Supabase (Postgres + Auth) · Gemini Flash (the only AI) · CricketData.org. No Anthropic/Claude API is used anywhere in the code.

> **Grading guide:** see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a map of every tool in the stack and the folder it lives in. **Frontend:** `frontend/`. **Backend:** `backend/`. Pure rules: `shared/`. Database: `supabase/`.

## Setup

1. **Supabase**: create a project. In the SQL editor run [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql). In *Authentication → Providers → Email* turn **off** "Allow new users to sign up", then add Aryan under *Authentication → Users* (email + password). RLS only admits signed-in users, so with sign-ups off only he can read or write anything.
2. **Keys**: Gemini key from Google AI Studio; CricketData key from cricketdata.org (free tier: 100 hits/day).
3. **Env**: `cp .env.example .env.local` and fill it in (table below).
4. `npm install && npm run dev`, open http://localhost:3000, sign in.
5. `npm test` runs the rules-engine tests (builder optimality vs brute force, validator, generic-reason filter, name matching).

### Environment variables (all server-only, none are `NEXT_PUBLIC_`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Database + auth. Used only in API routes and middleware; the browser never talks to Supabase (login goes through `/api/auth/login`). |
| `GEMINI_API_KEY` | All AI tasks. `GEMINI_MODEL` optionally overrides the default `gemini-3.8-flash`. |
| `CRICKETDATA_API_KEY` | Sent as `?apikey=` so every call is server-side. `CRICKETDATA_DAILY_LIMIT` (default 95) is the self-imposed budget. |

### Deploy
Push to GitHub, import in Vercel, add the same variables, deploy. Routes that call Gemini declare `maxDuration = 60`; the build is split into three short calls (conditions → expected points → build) so each stays well inside it.

## Fantasy history, expected points and the new pieces

- **Cricsheet history (`player_match_points`).** `npm run ingest:cricsheet` downloads free ball-by-ball T20 data from [Cricsheet](https://cricsheet.org) (ODC-BY, please keep the credit): the T20 internationals file plus the league files (IPL, Big Bash, Women's Big Bash, PSL, CPL, SA20, ILT20, LPL, BPL, MLC, T20 Blast, MSL, WPL, Syed Mushtaq Ali). Cricsheet's `t20s` file is internationals only, so the leagues are separate downloads, computes every player's Dream11 points per match with `shared/scoring.ts`, and stores one row per player-match. Run the SQL in `supabase/migrations/0004_player_match_points.sql` first. Keep it fresh with `npm run ingest:cricsheet -- --zip recently_added_7_json.zip`.
- **Expected points are built in code, then adjusted by Gemini.** `base = 50% × overall fantasy average + 50% × average of the last 10 matches` (`shared/form.ts → blendBase`). If a player has too little of one (fewer than 5 overall or 3 recent matches) the other is used alone and the card says so. Gemini then returns only an **adjustment** for the pitch, weather, opponent and batting position, capped at ±40% of the base. Players with no history get Gemini's own estimate, clearly labelled.
- **Daily refresh.** Vercel Cron calls `/api/cron/cricsheet` every day at 02:30 UTC (`vercel.json`). It pulls Cricsheet's small "recently added (7 days)" file and the name register, so new matches and new spellings arrive without you doing anything. It is protected by the `CRON_SECRET` environment variable. Note it writes with the anon key, so if you later run `0003_lock_again.sql` the refresh stops working until it is given a server-side key.
- **Strict name matching.** A short Dream11 name ("S Farhan") is linked to a Cricsheet player only inside that team's recent roster, and only on surname + first initial with exactly one hit. It also checks the player's other known spellings from Cricsheet's register (so "D Shanaka" finds "MD Shanaka"). Otherwise the player shows "couldn't match" and no history, never someone else's. If two squad players resolve to the same person (for example two "K Mendis"), both links are dropped.
- **Scoring rules.** `shared/scoring.ts` holds the current Dream11 T20 table (boundary +4, six +6, wicket +30, dot ball +1, strike-rate and economy bands, 25/50/75/100 milestones). It is used for the Cricsheet history and for "Fetch match results". The same values are seeded as **scoring weights version 2, inactive**: check them against the points-system page in the Dream11 app, then activate in Settings.
- **Lock / exclude and re-optimise.** Tap a player (in the XI or on the bench) to lock or exclude them, then re-optimise: the exact solver rebuilds the best valid XI around your choices, you see the changes once, and tag them gut or reasoned.
- **Agent vs a simple baseline.** Insights compares the agent's per-player misses with a plain "last-5 average" baseline, with a bootstrap 95% range, and says "too early to tell" until there are 20 comparable players.

**Scoring table: what it is and when it was checked.** The values in `shared/scoring.ts` match Dream11's own T20 points page as fetched on 12 Oct 2026 (run +1, boundary bonus +4, six bonus +6, milestones 25/50/75/100 = +4/+8/+12/+16, wicket +30, dot ball +1, LBW/bowled +8, 3/4/5-wicket +4/+8/+12, maiden +12, strike-rate and economy bands, catch +8, 3-catch +4, stumping +12, run out +12/+6, C 2x, VC 1.5x). Dream11's real-money contests ended in August 2025 (Promotion and Regulation of Online Gaming Act); that page shows no scoring change after the wicket value moved to +30 earlier in 2025. Weights version 2 holds these values and is the active version. Team-composition limits are NOT on that page, so the limits in Settings (7 per team by default, up to 10 allowed, WK 1-4, BAT 3-6, AR 1-4, BOWL 3-6) are unverified against the current app.

Ideas in this section were borrowed from two public repos, RK0297/DREAM11-TEAM-PREDICTOR (created 4 May 2025, last updated 4 Aug 2025, so it predates the August 2025 change) and Janu-Chaudhary/Predict-11 (created 1 Dec 2025; its scoring research was rewritten on 1 Oct 2026). No code was copied (neither has a licence file); the logic was re-implemented.

## How a player is chosen (the rubric)

| Step | Weight / rule | Source |
|---|---|---|
| Career average | **50%** of the base (players with 5+ earlier T20s) | Cricsheet ball-by-ball, scored with Dream11's T20 table, since 2018 |
| Recent form | **50%** of the base: recency-weighted average of the last 20 matches (each counts half as much as the one 5 newer) | same |
| 1-4 earlier matches | (n × own average + 2 × typical score) / (n + 2); typical 37.2 (1-2), 40.7 (3-4) | measured on ~2,500 cases |
| No history found | Gemini's own estimate, listed on the team card | Gemini |
| Match conditions | Gemini adds or subtracts points, capped at max(10, 40% of the base): pitch/venue record, weather and dew, opposition, batting position, role, team news, playbook rules, past errors | Gemini + Google Search |
| Which 11 | Exact search for the valid team with the highest total expected points: 11 players, WK 1-4, BAT 3-6, AR 1-4, BOWL 3-6, max 7 per team by default (Dream11 allows up to 10; editable in Settings), 100 credits when known | Code, no AI |
| Captain / vice-captain | 2× / 1.5×. Gemini picks; code keeps the captain in the top 3 by expected points and the VC in the top 4 | Gemini, checked by code |
| Final say | Aryan. Every override is tagged gut or reasoned; the agent argues once and never blocks | Aryan |

The same tables, with the live values, are on **Insights → How it decides**.

## Back-tests: what was tested and what changed

Insights → **Back-tests** builds a team for matches that already finished, using only information available before each one (history cut off before the match day, no web search, the real XI), then reads the actual points and runs an automatic post-mortem: biggest wrong picks, stars left out, captain finish, whether Gemini's adjustment helped, players with no history, bias by role and batting position. Finished matches tested: India v West Indies (6 Oct 2026), India v Pakistan (3 Oct), Bangladesh v Pakistan (1 Oct).

Any idea for a fix is then tested on ~1,236 past matches with no AI (`npm run backtest:formulas`), with a 95% confidence range and a split into two halves of the year. Result: three changes adopted (recency-weighted recent form, a steadier base for players with 1-4 matches, a captain safety net) and six ideas rejected with evidence (medians, shrinkage for experienced players, dropping half of the blend, floor/ceiling captains, and others). The log of every finding is on the page. Honest headline: single-match fantasy scores are mostly luck, and the history-based method captures about 76% of the best possible top-11 on average.

Run them yourself: `npm run backtest -- --logic v2 <cricsheet match id>`, `npm run backtest:formulas`, `npm run audit:form`.

## Is the recent-form data correct?

Insights → **Data check** compares the same players in the same match across two independent providers (Cricsheet ball-by-ball vs CricketData scorecards): 19 players, average difference 1.3 points, correlation 0.999. It also lists the raw-delivery proof (exact totals), the check of the scoring table against Dream11's own page, and the limits (the second-source comparison covers one match so far because CricketData's free tier is capped at 100 calls a day).

## Match Report page

**Match Report** is the one-match view for Aryan. He picks a match from a list (teams the agent built live, and the finished matches it was back-tested on) and sees: what the agent picked and when, how those players scored against the real top 11 (the best valid team in hindsight), the key metrics (captain rank, average miss per player vs a plain last-5 average, role mix, batting-order mix), the top-11 players it missed and why (how it ranked them, whether they had history, where they batted), its picks that disappointed, and an expected-vs-actual table for every player. Nothing is uploaded: who played and their points are read from the Cricsheet ball-by-ball record. **Insights** is the all-matches view that feeds back into the model; Match Report is one match at a time.

## Known limits of the history data
- Cricsheet publishes a few days late. A daily job tops the gap up from CricketData scorecards (dot balls estimated from runs and balls) and removes those rows once Cricsheet has the match. If CricketData's daily quota is used up, the top-up waits for the next day. 15 of the 100 daily hits are reserved for scorecards (fixture refreshes stop earlier and are cached 2 hours), and matches that could not be added yet are listed under Insights → Data check as "Waiting now" and retried every day. RapidAPI is used for fixtures only; its match endpoints returned empty scoreboards in testing, so it is not a source for finished matches.
- **Backup.** `npm run backup` writes every Supabase table (including the 200k+ history rows, back-tests and recommendation snapshots) as JSON to `backups/<timestamp>/` (gitignored). Restore is an upsert of those rows.
- Cricsheet stores player names as text, not unique ids, so two different players who share the same written name (it happens with short initials) could be merged. The team-roster check makes this unlikely but not impossible; using Cricsheet's identifiers would remove the risk.
- A side that Cricsheet doesn't cover (for example ACT Women, or Indian state teams outside Syed Mushtaq Ali) has no history, and the app says so.

## Dashboard and the short journey

- **Dashboard (home).** A hero card for the next T20/ODI with a countdown and one **Build my team** button; tiles for teams built, matches waiting for results, fantasy-history size and freshness, and the active scoring version; a searchable match list grouped by day with Upcoming / Today / Needs result / All filters. On wide screens it gets a left sidebar and a "history through …" badge in the top bar, in the style of the Predict-11 site.
- **One table instead of three steps.** On a match, upload the Dream11 screenshot and the app reads every player and role; the players Dream11 lists under "Played Last Match" are pre-ticked as the probable XI (only when a side's list is a usable size). Tick or untick right in the list, then press **Build my team**: it saves the squad, reads the pitch, pulls fantasy history, predicts and builds in one go. Credits are optional and hidden unless you add them. **Find announced XI** ticks the announced XI when it can be found.
- **Player panel.** Tapping a player opens a panel (a side panel on desktop) with expected points, how the number was built, history, the reason, and the captain / swap / lock / exclude actions.

## How a match flows

1. **Home**: today's/upcoming matches from CricketData (cached 30 min), a banner for matches awaiting results, and the day's API hit count.
2. **Match setup**: the squads and XI are found automatically (screenshots are optional, for credits only) → upload 1–3 Dream11 screenshots (downscaled in-browser) → Gemini extracts name/team/role/credit into an editable table. Credits are pre-filled from each player's last match and changed ones are highlighted. Confirmed credits are saved per match. Typing by hand, or "Use last known credits", is the fallback.
3. **XI**: tick the XI, paste names ("V Kohli" works), or fetch the toss from the API. Marked *probable* (pre-toss) or *confirmed*; every downstream screen carries that label.
4. **Conditions**: Gemini + Google Search returns pitch, surface, weather/dew, late news and venue record, with source links.
5. **Build**: expected points (Gemini, strict JSON, rejects and retries generic reasons) → best valid XI (plain code, exact search) → C/VC (Gemini, re-checked by code, retried once, falls back to the two top scorers).
6. **Team card**: XI in Dream11 tab order, credits used/left, C/VC badges, one-line reasons, bench calls. Copy-for-Dream11 text and Save-as-image.
7. **Decision gate**: tap a player to make C/VC or swap. The agent states its case once; Aryan tags the call *gut* or *reasoned* (optional reason chip) and it is saved. An override that breaks a rule is kept and the app suggests fixes around it; **Finalise is disabled until the team is valid**.
8. **Results**: one list, number inputs, one save. Covers the final XI plus any agent pick he dropped.
9. **Insights / Settings**: see below.

## How it maps to the Components Map

| Map lane / box | Where it lives |
|---|---|
| **Aryan** · picks match, uploads screenshots, contest type | `frontend/pages/home.tsx`, `frontend/pages/match-setup.tsx`, `frontend/components/CreditsEditor.tsx` |
| **Aryan** · reviews & submits (decision gate) | `frontend/pages/match-team.tsx`, `backend/routes/matches/[id]/decision/route.ts` |
| **Aryan** · post-match points | `frontend/pages/match-result.tsx`, `backend/routes/matches/[id]/results/route.ts` |
| **Aryan** · approves/rejects weights | Insights + Settings pages, `backend/routes/settings/suggestions/route.ts` |
| **Gemini** · reads credit screenshots | `backend/routes/matches/[id]/credits/extract/route.ts` |
| **Gemini** · expected points | `backend/services/pipeline.ts → predictExpectedPoints`, `.../predict/route.ts` |
| **Gemini** · C & VC + why per pick | `backend/services/pipeline.ts → pickCaptains` |
| **Gemini** · pattern finder | `backend/routes/insights/analyze/route.ts` |
| **Cricket data API** · fixtures, toss, squads | `backend/integrations/cricketdata.ts` (cache + budget), `backend/routes/matches/route.ts`, `.../xi/route.ts` |
| **Match Day App** · build XI & validate (code) | `shared/rules.ts` (`buildBestXI`, `validateTeam`, `suggestFixes`) |
| **Match Day App** · team card | `frontend/pages/match-team.tsx`, `.teamcard` in `frontend/styles/globals.css` |
| **Supabase** · loads memory | `backend/db/queries.ts` (`loadActiveWeights`, `loadPlaybook`), `errorPatternsFor` |
| **Supabase** · saves prediction / predicted vs actual / new weights | tables `predictions`, `actual_points`, `scoring_weights` (versioned) |
| **Claude Code** | Build-time only. Not referenced at runtime. |

## Success criteria: where each is visible

1. **Under 5 minutes**: setup page is a 5-step flow; build is one button.
2. **Repeated for any match**: matches come from the API or manual entry; nothing is per-match in code.
3. **Manual fallback for everything that can be late**: credits (type / last-known), XI (tick / paste), fixtures (manual match), conditions (refresh), API budget exhausted (stale cache → manual).
4. **Valid and specific**: `validateTeam` runs in the builder, after every override, and gates Finalise; `shared/reasons.ts` rejects generic reasons and the prediction call retries up to twice.
5. **Measurable**: Insights shows error per match, C/VC top-3 hit rate (agent vs Aryan), and the Agent vs Aryan scoreboard per situation, with plain-language findings.
6. **Failure risk**: a missing credit or XI returns HTTP 422 listing the gap, never a guess. Pre-toss runs carry an amber *probable XI* label.
7. **Judgment protected**: only buttons Aryan presses change weights, playbook rules, or the final team. The agent argues once, never blocks, never re-argues.
8. **Free tiers**: every CricketData call is cached in `api_cache` and counted in `api_usage`; at the limit it serves stale cache.
9. **Owner clear**: single Supabase user, sign-ups off; home screen reminds him of matches awaiting results.

## Design decisions worth knowing

- **Rules live in the `rules_config` table** (Settings screen). Nothing is hard-coded in the builder.
- **Conclusions need 8+ data points.** Below that Insights says "Too early to tell" and Gemini is not asked.
- **Weight suggestions are validated**: the key must exist, the evidence group must be one the code computed, and a change is capped at 25% of the current value.
- **Contest type** steers the C/VC choice (safe vs differential). Expected points stay unbiased.
- **Swapped-out captain**: the incoming player inherits the C/VC badge so the team never has an orphaned captain.
- **The agent's "case" at the gate** is built from stored predictions and reasons, so it costs no extra Gemini call.

## Known limits

- **Dream11 hides credits until 11 players are picked.** So the screenshots to upload are the team preview / captain screen of any 11-player selection (repeat with a different 11 to cover more of the pool). Credits not visible are never guessed: they fall back to the player's last known credit (flagged to verify) or the player is left out of the pool.

- CricketData's free tier does not reliably expose the *announced* XI. The squad endpoint is treated as a pool and Aryan ticks (or pastes) the XI. Impact substitutes are always manual.
- **Player statistics (older note, superseded above).** Overall career stats come from CricketData (cached 7 days), matched only on exact surname + first initial + country so a wrong player is never shown. On a real squad this covered about 8 of 22 players, because the API leaves many players blank. **Recent form (last 10 matches) has no external source we can use** (a Google Search lookup returned nothing reliable and was too slow), so the app builds its own: every result Aryan fetches or enters is saved per player, and the last 10 of those (fantasy points, newest first) are shown on the team card and given to the model. Overall and recent form get equal weight once a player has at least 3 recorded matches; before that the history is shown but not weighed. It starts empty and grows with every match. Pitch and venue conditions still come from Gemini + Search with source links.
- Dream11 scoring differs by format; the seeded weights are T20-style and are meant to be tuned through the approval loop.
