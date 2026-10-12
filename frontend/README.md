# frontend/
Everything that runs in the browser.
- `pages/`: one file per screen: home, login, match-setup, match-team, match-result, insights, settings. `app/**/page.tsx` contains one-line shims that point here, because Next.js needs pages under `app/`.
- `components/`: credit table, XI picker, nav, UI atoms.
- `api.ts`: the fetch wrapper that talks to the backend, and screenshot downscaling.
- `styles/globals.css`: the design system.
The frontend never reads a secret and never calls Gemini, CricketData, RapidAPI or Supabase directly.
