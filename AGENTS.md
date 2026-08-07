# AGENTS.md — smsbrinteva

SMS broadcasting service for Brinteva Worlds (Nicoll). Express + MySQL backend on
the VPS (`sms.brintevaworlds.com`, PM2 process `sms-bot`, port 3001), React +
Vite + Tailwind 4 admin UI in `admin-ui/`.

## Commands

- Admin UI: `cd admin-ui && npm run build` (also runs `tsc -b`; `npx tsc --noEmit` for a standalone typecheck). Vite dev: `npm run dev` (proxies `/api` to production, base `/admin/`).
- Backend: plain Node, no build step. Verify edits with `node --check <file>`.
- Tests: `npm test` runs `tests/*.test.js` (backend: hosted pages, crawlers, Kommo CRM) and `test/*.test.js` (the shared API contract validator) — two directories, one script.
- Migrations: plain SQL files in `migrations/`, dated `YYYY-MM-DD-description.sql`. Applied automatically on every deploy (see below) — `node scripts/apply-migration.js migrations/<file>.sql` is only needed for a manual/out-of-band run.
- Deploy: commit including built `public/admin/` assets, then push the production branch (assets are committed, not built on the server). The production remote's `post-receive` hook checks out the new code, runs `npm install`, **then applies every file in `migrations/` in order** (idempotent — safe to re-run already-applied ones), and only then restarts `pm2`. This exists because code and its migration can otherwise land in different deploys: on 2026-08-06, `lib/hosted.js` shipped expecting `hosted_messages.ai_structure` before that column existed, and every hosted-page send failed in production (`Unknown column 'ai_structure'`) until the migration was applied by hand. Consequence: a migration file only needs to exist in `migrations/` before the code that depends on it is pushed — it no longer needs a separate manual step, and forgetting one is now a deploy-time failure (hook aborts before `pm2 restart`) instead of a runtime one.
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

Committed on `main`, tests green (`npm test`: 139 passing):
- Hosted long-message pages (`lib/hosted.js`, `/i/:code`): seller-text parsing, Unsplash destination hero, and appended-itinerary support (multiple tours in one seller paste, split on `--- NUEVO ITINERARIO ---`) — `migrations/2026-08-03-hosted-messages.sql`.
- Hosted page rendering: `Incluye`/`No incluye` two-column block (contract in `docs/hosted-inclusions-parsing.md`), collapsible day sections with an expand/collapse control, print button, redesigned contact card/masthead/footer. GSAP is vendored same-origin in `public/vendor/` — the page's CSP is `script-src 'self'`, so a CDN is not an option; every enhancement degrades to static HTML.
- Crawler exclusion: `lib/crawlers.js`, blanket `X-Robots-Tag`, `/robots.txt` disallow-all.
- Structured event log: `migrations/2026-07-31-logs.sql`, `lib/logs.js`, `GET /api/logs`, admin `Logs.tsx` "Registro" tab.
- Shared API contract module (`shared/api-contract.js`/`.d.ts`, `test/api-contract.test.js`), merged 2026-08-05 from a branch that had sat unmerged since 2026-08-03.

Day-heading shapes the parser accepts, and one it decides per document:
- Worded (`Día 1: X`, `1er día — X`, `Friday, September 11: X`, `2026-09-11: X`) and, since 2026-08-05, the period-dash idiom `Día 1.- MADRID`, which needs no whitespace around the dash.
- Word-less `1.- MADRID` is special: nothing on the line marks it as a day, so it is indistinguishable from a numbered list item (`1.- Traslados` under `Incluye:`). `allowsBareNumberDays()` decides once for the whole paste and only when no other day shape appears anywhere, at least two candidates exist, they run 1, 2, 3… from the top, and no inclusion heading precedes the first. `matchDay()` keeps this branch **off by default** — callers opt in via `{ allowBareNumber }`, and `classifyItineraries()` decides once and passes the answer to every block. If you touch this, keep the reset guard working: a return to `1` mid-run must stay recognizable or two pasted itineraries merge silently instead of being refused as `ambiguous`.

Deploy status (verified 2026-08-06):
- `production` is at `2e968ae`: the Haiku hosted-parser feature (`lib/hostedInterpreter.js` + `lib/hosted.js` integration), the day title/description validation fix, and the WhatsApp→Share contact button change. `pm2` process `sms-bot` confirmed restarted clean on both pushes.
- `migrations/2026-08-06-hosted-ai-structure.sql` (the `hosted_messages.ai_structure`/`parse_*`/`title_origin`/`parsed_at` columns) is applied. It was *not* applied automatically by that deploy — the `post-receive` hook at that point didn't run migrations, so every hosted-page send failed in production (`Unknown column 'ai_structure'`) until it was applied by hand. The hook now applies `migrations/*.sql` on every deploy (see Commands above), so this specific gap shouldn't recur — but confirm any earlier migration's status directly against the VPS rather than assuming from deploy history predating that fix.
- Push access: `git push origin main` works with HTTPS credentials present in-session. `git push production main` needs `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_smsbrinteva_vps" git push production main` — the default SSH identity resolution fails (`Permission denied (publickey,password)`) even though a working key for `vuelosmundi@72.167.54.34` exists at that path; earlier notes claiming production push "must be run by a human" were wrong, just under-specified.

Notes:
- Crawler directives are advisory and are not a substitute for authentication or access control.
- No Nginx configuration was changed for the crawler work.
