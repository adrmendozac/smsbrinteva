# AGENTS.md — smsbrinteva

SMS broadcasting service for Brinteva Worlds (Nicoll). Express + MySQL backend on
the VPS (`sms.brintevaworlds.com`, PM2 process `sms-bot`, port 3001), React +
Vite + Tailwind 4 admin UI in `admin-ui/`.

## Commands

- Admin UI: `cd admin-ui && npm run build` (also runs `tsc -b`; `npx tsc --noEmit` for a standalone typecheck). Vite dev: `npm run dev` (proxies `/api` to production, base `/admin/`).
- Backend: plain Node, no build step. Verify edits with `node --check <file>`.
- Migrations: `node scripts/apply-migration.js migrations/<file>.sql` on the VPS. Migrations are plain SQL files in `migrations/`, dated `YYYY-MM-DD-description.sql`.
- Deploy: commit including built `public/admin/` assets, then push the production branch (assets are committed, not built on the server).

## Conventions

- UI text is Spanish (except brand names and the "Registro" tab title's tech word "logs").
- Built assets in `public/admin/` are committed and must be regenerated with every admin UI change.
- Admin UI uses self-hosted fonts: Google Sans (body), Geist Mono (`font-mono`), and Poppins 400–700 for phone numbers only via the `font-phone` utility (token `--font-phone` in `admin-ui/src/index.css`; static per-weight woff2s in `admin-ui/src/fonts/` because Poppins has no variable font).
- Phosphor icons: use canonical `XxxIcon` exports only (`ArrowClockwiseIcon`), bare names are deprecated aliases.
- Logging goes through `lib/logs.js` (`deps.log` injected, fire-and-forget, never log secrets like the PIN). Categories mirror `CATEGORIES` in `admin-ui/src/components/Logs.tsx`.
- Never commit secrets; config lives in env vars (PIN, JWT_SECRET, Kommo tokens, Vonage keys).
- There is no local MySQL — backend changes are statically verified only.

## Session state (2026-07-31)

Done (committed local, NOT deployed):
- Structured event log: `migrations/2026-07-31-logs.sql` (logs table), `lib/logs.js`, `GET /api/logs` in `index.js`, instrumentation across `lib/*.js`, admin `Logs.tsx` "Registro" tab (level/category filters, keyset pagination, "Cargar más").
- Poppins self-hosted and applied to phone numbers (7 sites in Recipients/AudiencePicker/Contacts).
- Footer "Ver registro" button (opens the Registro tab) in `Footer.tsx` via `onOpenLogs`.
- Rail counters hidden on the Registro tab (Reciben mensajes / No reciben mensajes gated off, Entradas stat removed; `logEntries`/`onLoaded` wiring deleted).
- Registro rail copy: eyebrow "logs", title "Registro de logs" (`App.tsx` Rail copy map).

Pending:
- Deploy everything to the VPS: apply `migrations/2026-07-31-logs.sql`, then commit + push (built `public/admin/` assets included).
- Pre-existing uncommitted changes (not ours, untouched): `admin-ui/src/lib/phone.ts`, `admin-ui/src/lib/preventInputZoom.ts`, `lib/kommoCrm.js`, `migrations/2026-07-05-consent-records.sql`.

## Session state (2026-08-03)

Done locally (uncommitted, NOT deployed):
- Whole-subdomain crawler exclusion is implemented in Express through `lib/crawlers.js`.
- Every Express response receives `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
- `GET /robots.txt` returns `User-agent: *` and `Disallow: /`.
- `index.js` registers crawler protection before body parsers, static files, and application routes.
- The obsolete itinerary-only robots handler was removed from `lib/hosted.js`.
- Regression coverage lives in `tests/crawlers.test.js`; the full suite passes with 41 tests.

Notes:
- No frontend build is required for this backend-only change.
- No Nginx configuration was changed.
- Crawler directives are advisory and are not a substitute for authentication or access control.
