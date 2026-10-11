# server/ (backend)
- `integrations/`: one file per external tool: `gemini.ts`, `cricketdata.ts`, `supabase.ts`. The only places API keys are read.
- `db/`: Supabase queries (rules, weights, playbook, matches, credits).
- `services/`: business logic: `preflight.ts` (stop-and-ask gate), `pipeline.ts` (Gemini prompts for conditions, expected points, captains), `insights.ts` (error, C/VC hit rate, scoreboard).
- `http.ts`: error handling shared by every API route.
The HTTP endpoints that call this code are in `app/api/`.
