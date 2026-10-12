# frontend/
Everything that runs in the browser. It never reads a secret and never calls Gemini, CricketData, RapidAPI or Supabase directly; it only talks to `/api/...` (the backend).
- `pages/`: one file per screen. `home` (dashboard), `match-setup` (squad and XI), `match-team` (team card and decisions), `match-result`, `report` (Match Report, one match), `insights` (all matches), `settings`, `login`. `app/**/page.tsx` holds one-line shims that point here.
- `components/`: `SquadEditor`, `Overview`, `Backtests`, `DataCheck`, `Rubric`, `StyleCard`, `FaceOff`, `Sparkline`, `Nav`, small UI pieces.
- `api.ts`: the fetch wrapper, and screenshot downscaling.
- `styles/globals.css`: the design system.
