# backend/
Everything that runs on the server.
- `routes/`: the HTTP endpoints (`/api/...`). `app/api/**` contains one-line shims that point here, because Next.js needs routes under `app/`.
- `integrations/`: one file per external tool: `gemini.ts`, `cricketdata.ts`, `rapidapi.ts`, `supabase.ts`. The only places API keys are read.
- `db/`: Supabase queries (rules, weights, playbook, matches, credits).
- `services/`: business logic: `preflight.ts` (stop-and-ask gate), `pipeline.ts` (Gemini prompts), `insights.ts` (error, C/VC hit rate, scoreboard).
- `http.ts`: error handling shared by every route.
