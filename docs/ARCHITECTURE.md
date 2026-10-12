# Architecture: what is used where

One Next.js project, split into clearly separated layers. Each tool in the stack has its own folder.

```
 Browser (phone)                    Vercel server                         External services
┌──────────────────┐   fetch()   ┌─────────────────────────┐          ┌──────────────────┐
│ FRONTEND         │ ──────────▶ │ BACKEND                 │ ───────▶ │ Gemini Flash     │
│ frontend/        │             │ backend/routes/ (API)   │ ───────▶ │ CricketData.org  │
│ client/          │ ◀────────── │ backend/ (logic)        │ ───────▶ │ Supabase         │
└──────────────────┘    JSON     │ shared/ (pure rules)    │          └──────────────────┘
                                 └─────────────────────────┘
```

## Layer → folder

| Layer | Folder | What is in it | Runs in |
|---|---|---|---|
| **FRONTEND** | `frontend/pages/` | One file per screen: home, login, match setup, team card, results, Insights, Settings | Browser |
| | `frontend/components/` | Credit table, XI picker, nav, UI atoms | Browser |
| | `frontend/api.ts`, `frontend/styles/` | Fetch wrapper, screenshot downscaling, design system CSS | Browser |
| **BACKEND** | `backend/routes/` | The HTTP endpoints: validate input, call services, return JSON | Server |
| | `backend/services/` | Gemini prompts, preflight "stop and ask" gate, insights maths | Server |
| | `backend/integrations/` | One file per external tool (Gemini, CricketData, RapidAPI, Supabase) | Server |
| | `backend/db/` | Supabase queries | Server |
| **SHARED** | `shared/` | Rules engine (best XI, validator), generic-reason filter, types. No network, no AI | Both |
| **DATABASE** | `supabase/migrations/` | Schema SQL | Supabase |
| **Next.js glue** | `app/`, `middleware.ts` | One-line shims that map URLs to `frontend/pages/` and `backend/routes/` (Next.js requires routes under `app/`), plus the root layout | n/a |

## Tool → folder

| Tool | Used for | Folder / files |
|---|---|---|
| **Next.js 15 + React 19 + TypeScript** | Frontend and API routes | `frontend/`, `backend/` |
| **Gemini Flash** (Google AI) | Screenshot reading, Search-grounded conditions, expected points, captains, pattern finder | `backend/integrations/gemini.ts` (client), `backend/services/pipeline.ts` and `backend/routes/insights/analyze/` (prompts) |
| **CricketData.org** | Fixtures, toss, squads | `backend/integrations/cricketdata.ts` (cache + 95/day budget) |
| **RapidAPI: Free Cricbuzz Cricket API** | Upcoming fixtures (second source, deduped against CricketData) | `backend/integrations/rapidapi.ts` (cache + 90/month budget) |
| **Cricsheet** (open ball-by-ball data) | Fantasy history per player: overall and last 10 matches | `backend/scripts/ingest-cricsheet.ts` (import), `backend/services/cricsheet.ts` (parser), `backend/services/history.ts` (lookup), `backend/services/cricsheet-ingest.ts` (shared import + aliases), `backend/routes/cron/cricsheet/` (daily refresh), `shared/scoring.ts` (Dream11 points) |
| **Back-tests and audits** | Prove the logic on finished matches, find where it breaks, test fixes | `backend/services/backtest.ts`, `shared/backtest.ts`, `backend/scripts/backtest*.ts`, `backend/scripts/audit-form.ts`, `backend/routes/insights/backtests/` |
| **Match Report page** | One match at a time: our picks vs the real top 11, key metrics, what was missed and why | `backend/routes/report/`, `shared/matchreport.ts`, `frontend/pages/report.tsx` |
| **Supabase** (Postgres + Auth) | All data storage and login | `backend/integrations/supabase.ts`, `backend/db/`, `supabase/migrations/` (schema) |
| **Vercel** | Hosting | `next.config.mjs`, env vars in the Vercel dashboard |
| **Vitest** | Tests of the rules engine | `tests/`, `vitest.config.ts` |
| **html-to-image** | "Save image" on the team card | `frontend/pages/match-team.tsx` |

## Rule of thumb for grading
- *AI decisions* (estimates, reasons, captain) → `backend/services/pipeline.ts`.
- *Hard rules* (is the team valid, who is the best XI) → `shared/rules.ts`. **No AI there, by design.**
- *Secrets* → only read in `backend/integrations/*` and `middleware.ts`; never in `frontend/`.
