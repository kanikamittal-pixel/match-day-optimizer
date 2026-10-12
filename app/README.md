# app/ (Next.js routing only)
Next.js requires pages and API routes to live under `app/`. Nothing is written here: every file is a one-line shim that re-exports the real code, so the project stays split in two.
- `app/**/page.tsx` re-exports a screen from [`frontend/pages/`](../frontend/pages).
- `app/api/**/route.ts` re-exports an endpoint from [`backend/routes/`](../backend/routes).
- `app/layout.tsx` is the root layout (fonts, navigation).
