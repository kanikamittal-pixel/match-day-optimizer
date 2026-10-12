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

## How a match flows

1. **Home**: today's/upcoming matches from CricketData (cached 30 min), a banner for matches awaiting results, and the day's API hit count.
2. **Match setup**: choose Small/Grand league → upload 1–3 Dream11 screenshots (downscaled in-browser) → Gemini extracts name/team/role/credit into an editable table. Credits are pre-filled from each player's last match and changed ones are highlighted. Confirmed credits are saved per match. Typing by hand, or "Use last known credits", is the fallback.
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

- CricketData's free tier does not reliably expose the *announced* XI. The squad endpoint is treated as a pool and Aryan ticks (or pastes) the XI. Impact substitutes are always manual.
- Recent player form and venue record come from Gemini + Search (with source links) rather than per-player API calls, to protect the 100-hit budget.
- Dream11 scoring differs by format; the seeded weights are T20-style and are meant to be tuned through the approval loop.
