# Kommo chat templates — review and pending changes

Account: `nicollbrintevaworlds.kommo.com` · Reviewed: 2026-09-16
Local source of truth for new wording: [`templates.json`](./templates.json)
Unedited snapshot of the live templates: [`templates-live-2026-09-16.json`](./templates-live-2026-09-16.json)

## ⏸ PENDING: WhatsApp review submission blocked (2026-09-16)

**Status:** on hold while access is requested from Kommo.

- The 15 new `waba` templates (51757–51785) are **MARKETING drafts** and
  have not been submitted to Meta.
- `POST /api/v4/chats/templates/{id}/review` returns **HTTP 200 with no
  error**, but creates no review:
  `{"_total_items":0,"_embedded":{"reviews":[]}}`. The template stays
  `draft`. A successful call returns a review with `"status": "review"`.
- Cause: in the UI, a WhatsApp template must be linked to a **WABA ID**
  (Brinteva Worlds `445728031966304`, reviewed through source `53840`). The
  add/edit templates API has no field for this link. `waba_id`, `source_id`,
  `sources`, `waba_account_id`, `waba_business_account_id` and
  `waba_source_id` were tested on draft 51773: they were ignored (HTTP 200),
  and the review request stayed empty with those values in its body too.
  `GET /api/v4/sources` returns 204, so the token's integration owns no
  WhatsApp source.
- The token's user (11004615) **is already a Kommo admin**. The missing piece
  is probably access to the integration that owns source 53840, or Kommo
  support explaining how to link an API template to a WABA.
- Nothing else is blocked. The 6 `amocrm` templates (51745–51755) are live.

**To resume, pick one:**
1. With a token from the integration that owns WABA/source 53840: recreate
   the 15 `waba` templates with that token (`templates.json` has everything),
   then submit them with `POST …/{id}/review`.
2. With Kommo's answer on how to link a WABA ID: PATCH the 15 drafts and
   submit them.
3. Fallback: recreate the 15 in the UI ("Nueva plantilla de WhatsApp" → WABA
   ID 445728031966304 → Español → Enviar a revisión).

After any of these, delete the 15 API drafts (51757–51785) through the API,
since this integration owns them. Then, once the new templates are approved,
delete the 24 old templates in the UI.

## Replacement plan: current IDs (to become old IDs)

21 templates are recreated with corrected text and the approved new names, which gives each one a new ID. 3 are not recreated and are only deleted: 51373 (its corrected text duplicates 47273) and the PDF templates 35174 and 35176 (no longer needed). Once each new template exists (and, for `waba`, is **approved** by Meta), delete the old ID. Record the new ID and dates here as you go. `templates.json` holds the same plan (`name` = new name, `old_name`, `plan`).

| Old ID | Type | Old name | New name | Plan | Meta status (2026-09-16) | Category | Text corrected | New ID | New status | Old ID deleted |
|---|---|---|---|---|---|---|---|---|---|---|
| 34886 | amocrm | Zelle | Pago - Zelle | recreate | — | — | yes | 51745 | active (no review) | |
| 34888 | amocrm | Xcaret | Promo - Hotel Xcaret México | recreate | — | — | yes | 51747 | active (no review) | |
| 34894 | amocrm | Deposito Bancario | Pago - Depósito bancario | recreate | — | — | no | 51749 | active (no review) | |
| 34900 | waba | Bienvenida 1 | Bienvenida - Primer contacto | recreate | approved | UTILITY | yes | 51757 | draft (MARKETING, not submitted) | |
| 34932 | waba | Bienvenida 2 | Bienvenida - Envío de cotización | recreate | approved | UTILITY | yes | 51759 | draft (MARKETING, not submitted) | |
| 34938 | amocrm | Ubicación | Info - Ubicación de oficinas | recreate | — | — | yes | 51751 | active (no review) | |
| 35036 | waba | Reactivación | Seguimiento - Trabajando en su viaje | recreate | approved | UTILITY | no | 51761 | draft (MARKETING, not submitted) | |
| 35052 | waba | Interesado Viaje | Seguimiento - Interés en su viaje | recreate | approved | UTILITY | yes | 51763 | draft (MARKETING, not submitted) | |
| 35172 | waba | Cotización | Seguimiento - Reservar o cotizar | recreate | approved | UTILITY | yes | 51765 | draft (MARKETING, not submitted) | |
| 35174 | amocrm | Presentación Parques GX | — | **delete only** (PDF template not needed) | — | — | no | n/a | n/a | |
| 35176 | amocrm | Restaurantes HXM Español | — | **delete only** (PDF template not needed) | — | — | no | n/a | n/a | |
| 35178 | amocrm | Que incluye Xcaret | Info - Qué incluye Hotel Xcaret | recreate | — | — | yes | 51753 | active (no review) | |
| 35440 | waba | Cotización día 2 | Seguimiento - Cotización día 2 | recreate | approved | UTILITY | no | 51767 | draft (MARKETING, not submitted) | |
| 36052 | amocrm | Dudas | Cierre - Dudas | recreate | — | — | yes | 51755 | active (no review) | |
| 36072 | waba | Que penso | Seguimiento - Qué pensó de su viaje | recreate | approved | UTILITY | yes | 51769 | draft (MARKETING, not submitted) | |
| 36953 | waba | Seguimiento Contacto Inicial | Seguimiento - Contacto inicial | recreate | approved | MARKETING | yes | 51771 | draft (MARKETING, not submitted) | |
| 37395 | waba | promociones | Promo - Enlace a promociones | recreate | approved | MARKETING | yes | 51773 | draft (MARKETING, not submitted) | |
| 38107 | waba | promocion | Promo - Sitio web | recreate | approved | MARKETING | yes | 51775 | draft (MARKETING, not submitted) | |
| 39331 | waba | Recordatorio Viaje | Recordatorio - Pasaporte y visas | recreate | approved | MARKETING | yes | 51777 | draft (MARKETING, not submitted) | |
| 40843 | waba | Quedamos a su espera | Cierre - Quedo atenta | recreate | **review (stuck)** | MARKETING | yes | 51779 | draft (MARKETING, not submitted) | |
| 40869 | waba | si quiere que le cotice algo mas me dice | Cierre - Cotizar algo más | recreate | **review (stuck)** | MARKETING | yes | 51781 | draft (MARKETING, not submitted) | |
| 47273 | waba | Prueba | Seguimiento - Disculpe la tardanza | recreate | approved | MARKETING | yes | 51783 | draft (MARKETING, not submitted) | |
| 50033 | waba | viajes grupales | Promo - Viajes grupales 2026 | recreate | approved | MARKETING | yes | 51785 | draft (MARKETING, not submitted) | |
| 51373 | waba | aun necesita su viaje) | — | **delete only** (duplicate of 47273 (same corrected text)) | approved | MARKETING | yes | n/a | n/a | |

Old ID list for the final delete (24):
`34886, 34888, 34894, 34900, 34932, 34938, 35036, 35052, 35172, 35174, 35176, 35178, 35440, 36052, 36072, 36953, 37395, 38107, 39331, 40843, 40869, 47273, 50033, 51373`

New-ID log: [`created-templates.json`](./created-templates.json)

**Status (2026-09-16)**
- Batch 1: 6 `amocrm` templates created (51745–51755). They are live and need
  no review.
- Batch 2: 5 `waba` templates created as **drafts** (51757–51765). Category changed from UTILITY to **MARKETING** (PATCH, 2026-09-16). All 15 new `waba` templates are MARKETING.
  `POST /chats/templates/{id}/review` returns 200 with an empty `reviews`
  list, both with no body and with `{}`, and the templates stay `draft`.
  `GET /api/v4/sources` returns 204, so this integration has no WhatsApp
  source of its own. The old templates were reviewed through source `53840`,
  which belongs to another integration (the WhatsApp channel). **The drafts
  must be submitted for review from the Kommo UI.**
- Batches 3 and 4: 10 `waba` templates created as **MARKETING drafts** (51767–51785), kept in draft on purpose. All 21 new templates were checked against `templates.json` (name, text, type, category, buttons, editable), and all match. The account now holds 45 templates (24 old + 21 new).
- Per the [Templates overview](https://developers.kommo.com/reference/templates):
  *"You can update/delete templates created by the current integration
  only."* The 24 old templates were made in the UI, so **the old IDs must be
  deleted in the Kommo UI, not through the API**. The new templates can be
  managed through the API.

**Order of operations**
1. Create the corrected templates (`POST /api/v4/chats/templates`). Read the
   create reference first and fill in the "New ID" column.
2. `waba` templates: wait until each new one shows `approved`
   (`GET /api/v4/chats/templates?with=reviews`). Until then the old one is the
   only sendable version.
3. Repoint any Salesbot or automation that uses an old ID.
4. Delete old IDs only after their replacements are ready. Deletion can't be
   undone. Do it in the **Kommo UI**, because the API can only delete
   templates this integration created. The request below works only for the
   new (integration-created) IDs, for example to remove a bad draft:
   ```sh
   curl --request DELETE \
     --url https://nicollbrintevaworlds.kommo.com/api/v4/chats/templates \
     --header "Authorization: Bearer $TOKEN" \
     --header 'Content-Type: application/json' \
     --data '[{"id": OLD_ID}, {"id": OLD_ID}]'
   ```
5. Notes for creating the new templates:
   - 35036 and 35440 have no text corrections but are still recreated (new
     names, fresh approval).
   - Set `is_editable: true` (it defaults to `false`) so the templates stay
     editable in the Kommo UI.
   - Keep `waba_category`, `waba_language` and `waba_examples` from the old
     template, and the three inline buttons on 50033.
   - The reference doesn't say how a new `waba` template is submitted to Meta
     (edits are only allowed in `draft`). Confirm this before creating them.

## Patch batch (34900, 34932, 35036, 40843, 40869) — NOT applied

None of these templates changed in Kommo. Every request was rejected before
anything was written.

| ID | Name | Meta status | JSON differs from Kommo | Result |
|---|---|---|---|---|
| 34900 | Bienvenida 1 | approved (UTILITY) | yes | rejected: `Template with id 34900 not found` |
| 34932 | Bienvenida 2 | approved (UTILITY) | yes | rejected: `Template with id 34932 not found` |
| 35036 | Reactivación | approved (UTILITY) | **no** | skipped — same text, a PATCH would only trigger a new Meta review |
| 40843 | Quedamos a su espera | **review** (MARKETING) | yes | rejected: `Template with id 40843 not found` |
| 40869 | si quiere que le cotice algo mas me dice | **review** (MARKETING) | yes | rejected: `Template with id 40869 not found` |

### What the API returned

| Request | Response |
|---|---|
| `GET /api/v4/chats/templates?with=reviews` | 200 — works, returns all 24 templates |
| `GET /api/v4/chats/templates/{id}` | 200 — every ID above exists |
| `PATCH /api/v4/chats/templates` with `buttons: []`, `waba_footer: ""` | 400 — `buttons` needs 1+ elements, `waba_footer` must not be blank |
| `PATCH /api/v4/chats/templates` without those fields | 400 — `EntityNotFound` for every ID |
| Same, adding `"type": "waba"` | 400 — `EntityNotFound` |
| `PATCH /api/v4/chats/templates/{id}` | 403 — `This is a private API` |

**Cause (from the
[Edit templates reference](https://developers.kommo.com/reference/edit-templates)):**
the request format was correct (`PATCH /api/v4/chats/templates`, an array of
objects with `id`), but the reference states two restrictions:

> The `waba` type template can only be edited in `draft` status.
>
> The method is available with administrator rights.

All four templates are `waba` templates in `approved` or `review` status, so the
API never treats them as editable and reports them as not found.
`PATCH /chats/templates/{id}` isn't in the public API (hence the 403).

**What this means**
- **`amocrm` templates** (34886, 34888, 34938, 35178, 36052) can be PATCHed
  through this endpoint, provided the token's user has admin rights.
- **Approved or in-review `waba` templates can't be edited through the API.**
  The options are:
  1. Edit them in the Kommo UI (Settings → Chat templates), copying the text
     from `templates.json`, if the UI allows editing approved templates.
  2. Create new `waba` templates through `POST /api/v4/chats/templates` with the
     new text, wait for Meta approval, then retire the old ones. The new
     templates get new IDs, so any Salesbot or automation that uses the old IDs
     needs updating.
- **The stuck 40843 and 40869** fall under the same rule. Recreating them is the
  most reliable way to get a fresh review.

### The two templates stuck in review

40843 and 40869 were submitted on 2025-04-11 and are still `review` after about
17 months. Meta normally decides within days, so these are stuck. Editing them in
the Kommo UI, or deleting and recreating them, should restart the review.

## Remaining templates (19)

"Edited" means `templates.json` has different text from what is live in Kommo.

| ID | Type | Name | Meta status | Category | Edited | Last update in Kommo |
|---|---|---|---|---|---|---|
| 34886 | amocrm | Zelle | — | — | yes | 2024-11-07 |
| 34888 | amocrm | Xcaret | — | — | yes | 2025-06-03 |
| 34894 | amocrm | Deposito Bancario | — | — | no | 2024-11-07 |
| 34938 | amocrm | Ubicación | — | — | yes | 2025-04-07 |
| 35052 | waba | Interesado Viaje | approved | UTILITY | yes | 2024-11-12 |
| 35172 | waba | Cotización | approved | UTILITY | yes | 2024-11-15 |
| 35174 | amocrm | Presentación Parques GX | — | — | no | 2024-11-15 |
| 35176 | amocrm | Restaurantes HXM Español | — | — | no | 2024-11-15 |
| 35178 | amocrm | Que incluye Xcaret | — | — | yes | 2024-11-15 |
| 35440 | waba | Cotización día 2 | approved | UTILITY | no | 2024-11-21 |
| 36052 | amocrm | Dudas | — | — | yes | 2024-12-04 |
| 36072 | waba | Que penso | approved | UTILITY | yes | 2024-12-05 |
| 36953 | waba | Seguimiento Contacto Inicial | approved | MARKETING | yes | 2024-12-26 |
| 37395 | waba | promociones | approved | MARKETING | yes | 2025-01-14 |
| 38107 | waba | promocion | approved | MARKETING | yes | 2025-02-05 |
| 39331 | waba | Recordatorio Viaje | approved | MARKETING | yes | 2025-03-04 |
| 47273 | waba | Prueba | approved | MARKETING | yes | 2026-01-07 |
| 50033 | waba | viajes grupales | approved | MARKETING | yes | 2026-05-27 |
| 51373 | waba | aun necesita su viaje) | approved | MARKETING | yes | 2026-08-13 |

`amocrm` templates are internal to Kommo and have no Meta review, so editing
them carries no approval risk. Editing an approved `waba` template will probably
send it back to Meta for review, and it may not be usable until approved.

## Findings

### Expired dates (fixed in `templates.json`, not yet in Kommo)
- **34888 Xcaret.** The live text still offers "del 14 al 17 de septiembre o del
  4 al 7 de diciembre" (a 2025 promo). The new text keeps both prices (2,650 USD
  for 2 adults, 2,800 USD for 2 adults + 2 under 17, 4 days) and drops the dates.
  The prices are from 2025, so confirm they still apply. Without the dates, it
  no longer shows that the 2,800 USD price was only for December.
- **50033 viajes grupales.** Two trips were listed for "Septiembre" 2026. The new
  text removes that month and keeps all four trips with their days. It adds
  "2026" to Tailandia (Octubre) and Morelia (Diciembre) and removes the emojis.
  The Tailandia trip is about two weeks out, so confirm it still has space.

### Content to verify
- **34938 Ubicación.** The Guadalajara phone `33 666 160` has 8 digits; Mexican
  numbers have 10. The street is corrected to "Av. Federalismo Norte" in the JSON.
- **34886 Zelle / 34894 Deposito Bancario.** These payment details have not
  changed since 2024-11-07. Confirm the account details are still correct before
  republishing.
- **47273 Prueba.** A test-named template that is approved and sendable. Rename it
  (for example "Disculpe la tardanza") or delete it. With the JSON edits, its text
  is identical to 51373 ("Disculpe la tardanza. ¿Aún necesita que le cotice su
  viaje?"), so one of the two is redundant.
- **51373 "aun necesita su viaje)".** The name has a stray `)`.
- **37395 promociones.** Its button links to
  `https://brintevaworlds.com/#promociones`. Check that the page lists current
  offers.
- **50033 buttons** ("Quieres mas info?", "Buscas otro viaje?", "cotiza en linea")
  are missing accents and opening question marks. They were left unchanged.

### Emoji use
- **38107 promocion.** Still has 7 emojis after the edit.
- **35178 Que incluye Xcaret.** 12 ✅ bullets.

Reduce these if the "few or no emojis" rule should apply to all templates.

### Local repo notes
- The `backups/` folder (with an encrypted production SQL dump) is untracked and
  not gitignored, and the dump is mode 644. Add `backups/` to `.gitignore` and
  run `chmod 600` on the dump.
- `KOMMO_CRM_TOKEN` expires on **2027-02-28**. Renew it before then; CRM calls
  fail silently once it expires.
