# AGENTS.md — smsbrinteva

SMS broadcasting service for Brinteva Worlds (Nicoll). Express + MySQL backend on
the VPS (`sms.brintevaworlds.com`, PM2 process `sms-bot`, port 3001), React +
Vite + Tailwind 4 admin UI in `admin-ui/`.

## Commands

- Admin UI: `cd admin-ui && npm run build` (also runs `tsc -b`; `npx tsc --noEmit` for a standalone typecheck). Vite dev: `npm run dev` (proxies `/api` to production, base `/admin/`).
- Backend: plain Node, no build step. Verify edits with `node --check <file>`.
- Tests: `npm test` runs `tests/*.test.js` (backend: hosted pages, crawlers, Kommo CRM) and `test/*.test.js` (the shared API contract validator) — two directories, one script.
- Migrations: `node scripts/apply-migration.js migrations/<file>.sql` on the VPS. Migrations are plain SQL files in `migrations/`, dated `YYYY-MM-DD-description.sql`.
- Deploy: commit including built `public/admin/` assets, then push the production branch (assets are committed, not built on the server).
- Local preview of the hosted itinerary template: root `vite` devDependency serves `itinerario.html` (`npx vite`, then open `/itinerario.html`). That file is a static, gitignored scratch copy for eyeballing `lib/hosted.js` template/CSS changes — it is never read by the server; the real page is rendered live at `/i/:code`.

## Conventions

- UI text is Spanish (except brand names and the "Registro" tab title's tech word "logs").
- Built assets in `public/admin/` are committed and must be regenerated with every admin UI change.
- Admin UI uses self-hosted fonts: Google Sans (body), Geist Mono (`font-mono`), and Poppins 400–700 for phone numbers only via the `font-phone` utility (token `--font-phone` in `admin-ui/src/index.css`; static per-weight woff2s in `admin-ui/src/fonts/` because Poppins has no variable font).
- Phosphor icons: use canonical `XxxIcon` exports only (`ArrowClockwiseIcon`), bare names are deprecated aliases.
- Logging goes through `lib/logs.js` (`deps.log` injected, fire-and-forget, never log secrets like the PIN). Categories mirror `CATEGORIES` in `admin-ui/src/components/Logs.tsx`.
- `shared/api-contract.js` (+ `.d.ts`) is the CommonJS-and-TypeScript-shared source of truth for the admin API request/response shapes; `admin-ui/src/lib/api-contract.typecheck.ts` is a compile-only check that the `.d.ts` and the frontend's own usage stay aligned.
- Never commit secrets; config lives in env vars (PIN, JWT_SECRET, Kommo tokens, Vonage keys).
- There is no local MySQL — backend changes are statically verified only.
- `main` is the only long-lived branch. Land feature branches with a merge (or delete after merge) rather than letting them linger — `feature/shared-api-contract` and `logs-feature` sat unmerged/stale for two days before a 2026-08-05 cleanup caught them, one of them carrying real unmerged work.

## Current state (2026-08-05)

Committed on `main`, tests green (`npm test`: 121 passing):
- Hosted long-message pages (`lib/hosted.js`, `/i/:code`): seller-text parsing, Unsplash destination hero, and appended-itinerary support (multiple tours in one seller paste, split on `--- NUEVO ITINERARIO ---`) — `migrations/2026-08-03-hosted-messages.sql`.
- Crawler exclusion: `lib/crawlers.js`, blanket `X-Robots-Tag`, `/robots.txt` disallow-all.
- Structured event log: `migrations/2026-07-31-logs.sql`, `lib/logs.js`, `GET /api/logs`, admin `Logs.tsx` "Registro" tab.
- Shared API contract module (`shared/api-contract.js`/`.d.ts`, `test/api-contract.test.js`), merged 2026-08-05 from a branch that had sat unmerged since 2026-08-03.

Deploy status (unconfirmed from a local checkout — no VPS shell access to verify directly):
- The `production` remote-tracking ref last observed matching `main`'s pre-merge tip, suggesting the hosted-itinerary work made it to the VPS via `git push production` — but the 2026-08-03 `hosted_messages` migration's actual application on the VPS is not verifiable from git and should be double-checked before relying on it.
- Today's merge commit (shared API contract) has not been pushed anywhere yet — neither `origin` nor `production`.
- `origin` (GitHub backup) is several commits behind local `main`.

Known local-only, uncommitted, left alone on purpose: a WIP tweak to `lib/hosted.js`/`tests/hosted.test.js` adding an "Itinerario N" label between appended tours, plus a `tests/render-two-itineraries-preview.js` dev script — mid-thought, not part of this cleanup pass.

Notes:
- Crawler directives are advisory and are not a substitute for authentication or access control.
- No Nginx configuration was changed for the crawler work.
