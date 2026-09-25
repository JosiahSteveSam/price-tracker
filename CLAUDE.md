# CLAUDE.md — agent rules for PricePulse

Scheduled price and stock tracker for the INE mock store (`https://demo.inelabteamdev.com`). Assignment deadline: **Sun 2026-09-27 13:00 IST**.

## Source of truth (read before building anything)

| Doc | Read it when |
|---|---|
| [docs/01-PRD.md](docs/01-PRD.md) | Any feature question: scope, definitions (attempt, try, outcome), CSV spec |
| [docs/02-TRD.md](docs/02-TRD.md) | Stack, folder layout, env vars, API routes, scheduling, constraints |
| [docs/03-APP-FLOW.md](docs/03-APP-FLOW.md) | Pages, journeys, loading/empty/error states |
| [docs/04-UI-UX-BRIEF.md](docs/04-UI-UX-BRIEF.md) | Any UI work: tokens, typography, components |
| [docs/05-BACKEND-SCHEMA.md](docs/05-BACKEND-SCHEMA.md) | Any DB work: tables, constraints, CSV mapping |
| [docs/06-IMPLEMENTATION-PLAN.md](docs/06-IMPLEMENTATION-PLAN.md) | What to build next and when a phase is done |
| [docs/07-SCRAPER-SPEC.md](docs/07-SCRAPER-SPEC.md) | Any scraper work: pipeline, selectors, validation, error codes, retries |

If the code needs to differ from a doc, **update the doc in the same change**. Don't let them drift.

## Non-negotiable rules

1. **Scrape only `STORE_BASE_URL`.** Never scrape real retailers or any other host.
2. **Never store unvalidated data.** A failed attempt has an empty price and stock. Never write a placeholder, zero, previous value or guess.
3. **Never fail silently.** Every due item in every run gets exactly one `scrape_attempts` row, including crashes (`RUN_INTERRUPTED`) and budget overruns (`RUN_BUDGET_EXCEEDED`).
4. **Don't weaken the DB honesty constraints** to make an insert pass. Fix the data or the code.
5. **Don't hard-code the store's CSS class names.** Use the manifest captured from the same page load (doc 07 §Selectors).
6. **Don't reimplement the store's challenge over HTTP** (no forged fingerprints or pointer data). Price and stock come from a real Playwright page; everything else uses plain `fetch`.
7. Concurrency 1 against the store; keep backoff and jitter in place.
8. Secrets only in env vars. Never commit `.env`; never expose the service-role key to the frontend.
9. Simulated faults (`--simulate`) must never reach the database.

## Commands

```bash
# backend
cd backend && npm run dev                 # API on :3000 (tsx watch)
cd backend && npm test                    # vitest
cd backend && npm run typecheck && npm run lint
cd backend && npm run scrape -- --all     # headless one-off run (dry-run unless --save)
cd backend && npm run scrape:headed -- --product 2312 --option o3

# frontend
cd frontend && npm run dev                # Vite on :5173, needs VITE_API_BASE_URL
cd frontend && npm run build && npm run typecheck
```

## Working conventions

- TypeScript strict, ESM, `camelCase` in code, `snake_case` in the DB, `camelCase` JSON (map in the repositories).
- UTC `timestamptz` everywhere; ISO 8601 with `Z` in the API and CSV.
- Money in integer minor units inside the scraper; `numeric(12,2)` in the DB.
- Small, focused modules as laid out in TRD §Repository layout. Validate every external input with zod.
- Before calling something done: run the tests and the typecheck, and for scraper changes do a headed or headless run against the live store and check the values by eye.

## NOTES.md (required for the design note)

Whenever an AI-generated approach turns out wrong (wrong assumption about the store, a bug, a bad pattern), add an entry to [NOTES.md](NOTES.md): **what was wrong → how it showed up → the fix**. Record key decisions and trade-offs there too. The final `DESIGN_NOTE.md` is built from it.
