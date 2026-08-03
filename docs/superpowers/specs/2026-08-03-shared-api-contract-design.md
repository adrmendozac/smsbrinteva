# Shared Admin API Contract — Design

**Date:** 2026-08-03  
**Status:** Draft for review

## Goal

Create one dependency-free contract layer for the admin API so Express routes
validate request data consistently and the React client has an explicit source
for request and response shapes. This draft covers the API used by
`admin-ui/`; it does not redesign the public webhooks, Kommo callbacks, database
schema, or deployment process.

No frontend build is part of this change. `public/admin/` remains untouched.

## Current problem

The frontend declares response types in `admin-ui/src/types.ts`, while backend
routes validate request bodies independently with checks such as `if (!name)`.
Those two descriptions can drift. Invalid container types can also reach route
logic—for example, a scalar `contactIds` value reaches code that expects an
array and becomes a server error instead of a useful `400` response.

## Chosen approach

Add a small CommonJS module at `shared/api-contract.js`. It will contain:

- Reusable schema primitives for strings, numbers, booleans, nullable values,
  arrays, objects, and enums.
- Named request and response contracts for the admin API.
- A `validate(contract, value)` function returning either a validated value or
  structured issues.
- A `ValidationError` carrying safe field-level issues.
- Express helpers that validate `body`, `params`, and `query` and return a
  consistent `400` response.

The module will use plain JavaScript and no runtime dependency. It must remain
free of Express, browser, database, and provider-specific imports so it can be
required from backend modules and inspected by frontend tooling.

The first implementation will favor explicit validators over a general JSON
Schema implementation. Supporting arbitrary schema features, coercion, schema
generation, or OpenAPI export is outside this draft.

## Contract scope

The first contract set covers the endpoints currently called by
`admin-ui/src/lib/api.ts`:

| Area | Requests | Responses |
|---|---|---|
| Authentication | login PIN | JWT token |
| Contacts | create, update, archive, numeric route ID | contact and contact lists |
| Campaigns | create, send, archive, numeric route ID | campaign lists and detail |
| Media | conflict query option | upload and conflict payloads |
| Account | none | balance and optional pricing data |
| Logs | level, category, before, limit | paginated log entries |
| AI suggestion | prompt | suggested SMS text |

The existing authenticated Kommo utility routes are excluded because the admin
frontend does not call them. Public opt-in and provider webhooks are also
excluded: they have different trust and compatibility requirements and should
receive separate contracts later.

## Validation behavior

Validation is strict at API boundaries:

- Objects reject unexpected fields unless a contract explicitly allows them.
- Required and optional fields are declared separately.
- IDs must be positive integers.
- `contactIds` and `phones` must be arrays, with per-item validation.
- Campaign status, recipient status, log level, and media conflict behavior use
  explicit enums.
- ISO schedule strings must represent a valid date; the campaign route retains
  the business rule that the date must be in the future.
- Phone normalization and SMS sanitization remain domain operations in their
  existing modules. The shared contract only verifies the input shape and
  reasonable length limits.
- Validation never exposes stack traces, SQL details, secrets, or raw provider
  errors.

Invalid requests return:

```json
{
  "error": "Invalid request",
  "issues": [
    { "path": "body.contactIds", "message": "Expected an array" }
  ]
}
```

Existing business-rule errors such as duplicate contacts, opted-out audiences,
past schedules, and missing records keep their current status codes and Spanish
UI messages.

## Backend integration

Route modules will validate at the beginning of each handler, before database
or provider calls. The composition root will import the shared contract once
and pass the appropriate validation helper into route registration alongside
the existing dependencies.

`index.js` will use the same helper for login, logs, and the route parameters of
its admin-facing handlers. Domain modules such as `lib/campaigns.js` and
`lib/contacts.js` will consume named contracts instead of reproducing body
checks.

Response validation will be enabled in development and tests. Production
responses will not be blocked by a contract mismatch during this first phase;
the mismatch will be logged so contract adoption cannot unexpectedly take down
the live admin panel. Request validation is enforced in every environment.

## Frontend integration

`admin-ui/src/lib/api.ts` remains the single transport module. Its methods will
refer to contract names and keep returning strongly typed values.

Because the backend runs CommonJS directly and the frontend compiles
TypeScript, the draft will include `shared/api-contract.d.ts` beside the runtime
module. The declaration file exposes the public contract names and derived API
value types to TypeScript. `admin-ui/src/types.ts` will retain UI-only derived
types and helpers, while transport DTOs move to the shared declaration surface.

The runtime schema is authoritative for validation. A contract parity test will
assert that every exported runtime contract has a matching declaration export,
preventing silent additions on only one side. Automatic declaration generation
can replace this bridge later if the project adopts a build step for shared
code.

## Files

Planned additions:

- `shared/api-contract.js`
- `shared/api-contract.d.ts`
- `test/api-contract.test.js`

Planned edits:

- `index.js`
- `lib/campaigns.js`
- `lib/contacts.js`
- `lib/media.js`
- `lib/account.js`
- `admin-ui/src/lib/api.ts`
- `admin-ui/src/types.ts`
- `admin-ui/tsconfig.app.json` if needed to include the shared declarations
- root `package.json` to add a contract-test command

No generated file under `public/admin/` will be edited.

## Testing

Tests use Node's built-in `node:test` and `node:assert`, avoiding a new test
framework. They will be written before runtime implementation and cover:

- Valid and invalid primitives, arrays, objects, optional fields, and enums.
- Stable field paths for nested errors.
- Rejection of unknown fields.
- Login, contact, campaign, media, account, and logs contract examples.
- The malformed `contactIds` case returning a validation issue instead of
  throwing inside campaign resolution.
- Runtime/declaration export parity.

Verification for the draft implementation will run the contract tests,
`node --check` on edited backend JavaScript, and `npx tsc --noEmit` in
`admin-ui/`. It will deliberately not run `npm run build`.

## Migration strategy

Adoption is incremental but lands as one coherent source change:

1. Add the shared validator and failing tests.
2. Integrate request contracts into the routes used by the admin frontend.
3. Move transport DTO declarations to the shared TypeScript surface.
4. Typecheck without generating assets.
5. Leave public/provider endpoints and unused Kommo admin routes unchanged.

## Non-goals

- Generating OpenAPI documentation.
- Replacing Express or CommonJS.
- Changing authentication or JWT storage.
- Changing database tables or migrations.
- Validating Vonage or Kommo webhook payloads.
- Refactoring `index.js` into services beyond the validation integration.
- Building or committing new `public/admin/` assets.

