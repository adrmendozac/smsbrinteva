# Brinteva SMS — Inbox CRM UI Design

**Date:** 2026-06-22
**Scope:** Front-end only, mock data, no backend. CRM-style shared inbox for SMS support agents.
**Status:** Approved by user, ready for implementation plan.

---

## 1. Context

Part of the larger `sms.brintevaworlds.com` system (see project `README.md`). The full
product decomposes into five sub-projects: Auth, **Inbox CRM (this doc)**, Vonage Messages
API migration, Broadcasts, and WhatsApp. This spec covers **only the Inbox UI**, built
against mock data with no live backend. Real-time (Socket.io), auth, and send wiring come
in later cycles.

## 2. Design read

Reading this as a B2B internal CRM inbox for SMS support agents, with a Linear-style
clean-product language, leaning toward Vite + React + TS + Tailwind v4 + shadcn/ui (owned
components), restrained purposeful motion (GSAP for the few moments that earn it),
daily-app density.

**Dials:** `DESIGN_VARIANCE 3 / MOTION_INTENSITY 4 / VISUAL_DENSITY 6` — a CRM is
symmetric and information-dense, not artsy; motion is feedback-only, never decorative.

**Design-skill applicability:** `design-taste-frontend` is explicitly out of scope for
dashboards / dense product UI / data tables / realtime collab UIs (its Section 13). We
therefore apply only its *anti-slop principles* (no AI-purple, no default Inter, color &
shape consistency locks, real interactive states, motion-must-be-motivated, WCAG AA
contrast, zero em-dashes, dark mode, reduced-motion, realistic data — no "Jane Doe"/"Acme")
and reach for a real product-UI foundation instead of its landing-page blocks.

## 3. Stack & architecture

- **Vite + React 18 + TypeScript.** No backend means no SSR benefit; Next.js would only
  add RSC-boundary friction around animation islands. Vite builds static assets that drop
  into `public/inbox/` behind Nginx — matches the project's deploy model.
- **Tailwind v4** via `@tailwindcss/vite` (not the legacy PostCSS plugin).
- **shadcn/ui** primitives, restyled to brand — never shipped in default state.
- **GSAP** for motion (per user request + `gsap-performance` skill): transform/opacity
  only, `gsap.context()` with cleanup in `useEffect`, all gated behind
  `prefers-reduced-motion`. No `window.addEventListener('scroll')`.
- **Icons:** `@phosphor-icons/react`, one family, `strokeWidth` locked globally.
- **Font:** Geist (self-hosted, `font-display: swap`). Matches the clean-sans brand
  wordmark and avoids default-Inter.
- **State:** typed `mockData.ts` + a light Zustand store for selected conversation and UI
  state. No network layer.
- **Project location:** new `inbox-ui/` directory; production build output targets
  `public/inbox/`.

## 4. Component tree

```
<InboxApp>
 ├─ <Sidebar/>            navy rail: Brinteva logo, nav, agent avatar
 ├─ <ConversationList/>   search, status filter tabs, rows
 │    └─ <ConversationRow/>  name, last-msg preview, time, status pill, unread dot
 ├─ <Thread/>            (or <EmptyThread/> when nothing selected)
 │    ├─ <ThreadHeader/>   contact name/number, status, channel
 │    ├─ <MessageList/>    <MessageBubble/> inbound | outbound(ai|human|system)
 │    ├─ <TypingIndicator/>
 │    └─ <ReplyBox/>
 └─ <ContactPanel/>      number, detected language, opt-in/out, convo status, timeline
```

Each unit has one clear purpose, communicates via typed props, and renders standalone
against mock data.

## 5. Visual system (locked tokens)

- **Theme:** light + dark, system-aware (`prefers-color-scheme`) + manual toggle. One
  theme per render, no mid-page inversion.
- **Accent role (user decision — navy-primary, crimson sparingly):**
  - Navy `#24243C` = UI chrome + primary buttons (calm, all-day legible).
  - Crimson `#C8103C` = brand moments only (logo, active-conversation left-bar, unread dot).
  - Brighter blue `#305AA0` = links / focus rings.
- **Neutrals:** zinc scale. No pure `#000000` / `#ffffff`.
- **Semantic colors (kept distinct from brand crimson):**
  - `resolved` → emerald
  - `needs_human` → amber
  - `ai_handling` → blue-tint
  - `open` → zinc
  - `error` → true red (visibly different from brand crimson)
- **Shape lock:** panels/cards radius 12px, inputs 8px, buttons pill. Applied everywhere.
- **Density 6:** compact rows, `font-mono` for phone numbers and timestamps.

## 6. Message sender styling

- **Inbound (contact):** left-aligned, zinc surface.
- **Outbound — human:** right-aligned, navy fill.
- **Outbound — AI:** right-aligned, navy *outline* + small "AI" tag, so agents instantly
  distinguish Claude's auto-replies from human replies.
- **System** (opt-in/out, escalation notices): centered, muted pill.

## 7. Motion plan (GSAP, every animation motivated)

| Moment | Animation | Justification |
|---|---|---|
| New inbound message | bubble slides up + fades in (y:12 to 0, 0.4s) | feedback: something arrived |
| Typing indicator | 3 dots staggered pulse | state: someone is composing |
| Conversation reorders to top on new msg | FLIP-style position shift | hierarchy: newest first |
| Unread badge appears | scale 0.8 to 1 spring pop | feedback: draws the eye |

All collapse to instant under `prefers-reduced-motion`. No decorative loops. Presence and
new-message events are simulated locally (timers over mock data); no Socket.io this round.

## 8. Mock data

Realistic bilingual contacts (EN/ES names, real-format US numbers e.g.
`+1 (412) 555-0173`), believable SMS threads mixing AI auto-replies and human handoffs,
varied conversation statuses. No "John Doe", no "Acme".

## 9. Scope boundaries

**In scope:** 3-pane shell; conversation list with search + status filters; message thread
with sender styling; reply box; contact context panel; presence (typing indicator,
new-message arrival, unread counters) simulated over mock data; intrinsic
"no conversation selected" empty state.

**Out of scope this round:** escalate/resolve action flows; full skeleton-loading and
error-toast system (nothing to load against mock data); auth/login; live Socket.io;
real send wiring; WhatsApp channel; broadcasts.

## 10. Accessibility & quality guardrails

- WCAG AA contrast on all text, buttons, inputs, placeholders, focus rings.
- Keyboard navigation and visible focus states (shadcn primitives + audit).
- Reduced-motion honored for all motion.
- No em-dashes anywhere in UI copy.
- Animate transform/opacity only; `gsap.context()` cleanup on unmount.
```
