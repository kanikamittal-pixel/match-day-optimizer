# Architecture: what is used where

One Next.js project, split into clearly separated layers. Each tool in the stack has its own folder.

```
 Browser (phone)                    Vercel server                         External services
┌──────────────────┐   fetch()   ┌─────────────────────────┐          ┌──────────────────┐
│ FRONTEND         │ ──────────▶ │ BACKEND                 │ ───────▶ │ Gemini Flash     │
│ app/ (pages)     │             │ app/api/ (HTTP routes)  │ ───────▶ │ CricketData.org  │
│ client/          │ ◀────────── │ server/ (logic)         │ ───────▶ │ Supabase         │
└──────────────────┘    JSON     │ shared/ (pure rules)    │          └──────────────────┘
                                 └─────────────────────────┘
```

## Layer → folder

| Layer | Folder | What is in it | Runs in |
|---|---|---|---|
| **Frontend: pages** | `app/` (all `page.tsx`, `layout.tsx`, `globals.css`) | Home, match setup, team card, results, Insights, Settings, login | Browser |
| **Frontend: components & helpers** | `client/` | Credit table, XI picker, nav, UI atoms, `api.ts` (fetch wrapper, image downscaling) | Browser |
| **Backend: HTTP API** | `app/api/**/route.ts` | Thin endpoints. They check input, call `server/`, return JSON. Next.js requires routes to live under `app/` | Server |
| **Backend: business logic** | `server/services/` | Prediction/captain prompts, preflight "stop and ask" gate, insights maths | Server |
| **Backend: database access** | `server/db/` | Supabase queries: rules, weights, playbook, match, credits | Server |
| **Shared pure logic** | `shared/` | Rules engine (best XI search, validator, fixes), generic-reason filter, name matching, default weights, types. No network, no AI | Server and browser |
| **Auth gate** | `middleware.ts` | Redirects signed-in/out users (Next.js requires this at the root) | Edge |

## Tool → folder

| Tool | Used for | Folder / files |
|---|---|---|
| **Next.js 15 + React 19 + TypeScript** | Frontend and API routes | `app/`, `client/`, `server/` |
| **Gemini Flash** (Google AI) | Screenshot reading, Search-grounded conditions, expected points, captains, pattern finder | `server/integrations/gemini.ts` (client), `server/services/pipeline.ts` and `app/api/insights/analyze/` (prompts) |
| **CricketData.org** | Fixtures, toss, squads | `server/integrations/cricketdata.ts` (cache + 95/day budget) |
| **Supabase** (Postgres + Auth) | All data storage and login | `server/integrations/supabase.ts`, `server/db/`, `supabase/migrations/` (schema) |
| **Vercel** | Hosting | `next.config.mjs`, env vars in the Vercel dashboard |
| **Vitest** | Tests of the rules engine | `tests/`, `vitest.config.ts` |
| **html-to-image** | "Save image" on the team card | `app/match/[id]/team/page.tsx` |

## Rule of thumb for grading
- *AI decisions* (estimates, reasons, captain) → `server/services/pipeline.ts`.
- *Hard rules* (is the team valid, who is the best XI) → `shared/rules.ts`. **No AI there, by design.**
- *Secrets* → only read in `server/integrations/*` and `middleware.ts`; never in `app/` pages or `client/`.
