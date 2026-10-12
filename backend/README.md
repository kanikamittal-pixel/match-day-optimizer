# backend/
Everything that runs on the server. `app/api/**` holds one-line shims that point to `routes/`.
- `routes/`: the HTTP endpoints (`/api/...`): matches, squad and XI, context, predict, build, decision, results, report, insights, settings, status, cron.
- `integrations/`: one file per outside service, and the only places API keys are read: `gemini.ts` (Gemini via OpenRouter), `cricketdata.ts`, `rapidapi.ts`, `supabase.ts`.
- `services/`: the logic. `pipeline.ts` (prompts and expected points), `history.ts` and `cricsheet*.ts` (fantasy history), `backtest*.ts`, `insights.ts`, `lookup.ts` (squad and XI search), `played.ts` (who played), `scorecard.ts`, `cd-topup.ts`, `preflight.ts` (stop and ask when data is missing).
- `db/`: Supabase queries (rules, weights, playbook, matches, credits).
- `scripts/`: command-line tools: `ingest-cricsheet`, `backtest`, `backtest-formulas`, `audit-form`, `backup`.
- `http.ts`: error handling shared by every route.
