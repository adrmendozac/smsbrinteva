# Shared API Contract Modules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dependency-free CommonJS contract module, matching TypeScript declarations, and tests for the admin API shapes without wiring routes or generating frontend assets.

**Architecture:** `shared/api-contract.js` is the runtime source of truth: it exports small schema builders, named contracts, and a validator returning structured issues. `shared/api-contract.d.ts` associates every runtime contract with its DTO type. Node's built-in test runner verifies runtime behavior and a TypeScript fixture verifies contract-specific inference.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, `node:assert/strict`, TypeScript declaration files.

**Foundation-phase boundary:** This plan sets up the shared modules only. Express helpers, route wiring, frontend DTO migration, response logging, and generated assets are deferred to a follow-up plan. Live API behavior does not change in this phase.

---

## Chunk 1: Runtime schema engine

### Task 0: Capture the starting repository state

**Files:**
- Verify only; do not modify files

- [ ] **Step 1: Record the complete worktree baseline before implementation**

Run: `git status --short`

Run: `git rev-parse HEAD`

Expected: retain the complete status output and starting commit hash for Task 6.
Every pre-existing modified or untracked file must still be present after the
contract commits unless it is explicitly part of this plan.

### Task 1: Schema primitives and validator

**Files:**
- Create: `test/api-contract.test.js`
- Create: `shared/api-contract.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for every schema primitive**

Create `test/api-contract.test.js` using `node:test` and
`node:assert/strict`. Require `schema` and `validate` from
`../shared/api-contract`. Add table-driven tests for:

- strings: type, `minLength`, `maxLength`, and `pattern`;
- finite numbers and integers: type, `min`, and `max`;
- booleans, literals, enums, and unions;
- arrays: item paths, `minItems`, and `maxItems`;
- strict objects, `allowUnknown`, and `minProperties`;
- optional object properties and nullable values;
- `unknown` values;
- no string/number/boolean coercion;
- valid and invalid ISO date-time strings;
- multiple nested issues with paths such as `contacts[0].id`.

Keep this named preservation example:

```js
test('validates a strict object and preserves its value', () => {
  const contract = schema.object({
    name: schema.string({ minLength: 1 }),
    active: schema.optional(schema.boolean())
  });

  assert.deepEqual(validate(contract, { name: 'Nicoll' }), {
    ok: true,
    value: { name: 'Nicoll' }
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/api-contract.test.js`

Expected: FAIL because `../shared/api-contract` does not exist.

- [ ] **Step 3: Implement the runtime schema API**

Create `shared/api-contract.js` with `'use strict'` and builders for:

```js
const schema = {
  string: (options = {}) => ({ kind: 'string', ...options }),
  number: (options = {}) => ({ kind: 'number', ...options }),
  integer: (options = {}) => ({ kind: 'integer', ...options }),
  boolean: () => ({ kind: 'boolean' }),
  unknown: () => ({ kind: 'unknown' }),
  literal: (value) => ({ kind: 'literal', value }),
  enum: (values) => ({ kind: 'enum', values: [...values] }),
  union: (variants) => ({ kind: 'union', variants: [...variants] }),
  isoDateTime: () => ({ kind: 'isoDateTime' }),
  array: (item, options = {}) => ({ kind: 'array', item, ...options }),
  object: (fields, options = {}) => ({ kind: 'object', fields, ...options }),
  optional: (inner) => ({ kind: 'optional', inner }),
  nullable: (inner) => ({ kind: 'nullable', inner })
};
```

Implement `validate(contract, value)` with these exact rules:

- success is `{ ok: true, value }`; failure is `{ ok: false, issues }`;
- input values are preserved and never coerced;
- numbers must be finite and integers must satisfy `Number.isInteger`;
- unknown object keys fail unless `allowUnknown: true`;
- `minProperties` counts present declared fields;
- optional is meaningful only for an absent object property;
- nullable accepts `null`, then validates non-null values with its inner schema;
- ISO date-time accepts only UTC wire values matching
  `/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/`.
  After parsing, compare the captured year/month/day/hour/minute/second with the
  corresponding UTC getters so normalized invalid dates such as February 30
  fail. This matches frontend `toISOString()` requests and JSON-serialized
  MySQL `Date` responses;
- a union succeeds on the first passing variant; if all fail, return the first
  variant's issues at the original path;
- validation accumulates independent object and array issues;
- paths use `field`, `parent.field`, and `items[0].field` notation.

Export `{ schema, validate }` with `module.exports`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/api-contract.test.js`

Expected: every primitive and composition test passes with 0 failures.

- [ ] **Step 5: Add and verify the root test command**

Add `"test": "node --test test/*.test.js"` beside the existing `start` script
in `package.json`.

Run: `npm test`

Expected: every validator test passes.

- [ ] **Step 6: Commit the schema engine**

```bash
git add package.json shared/api-contract.js test/api-contract.test.js
git commit -m "feat: add shared API contract validator"
```

## Chunk 2: Named admin contracts

### Task 2: Authentication and contacts

**Files:**
- Modify: `shared/api-contract.js`
- Modify: `test/api-contract.test.js`

- [ ] **Step 1: Write failing tests**

Add valid and invalid examples for every contract below. Verify that an empty
contact update fails, `{ id: '42' }` succeeds as a raw Express parameter, and a
numeric ID is not coerced.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because `contracts` is missing.

- [ ] **Step 3: Implement exact contracts**

Create a frozen `contracts` export with:

| Contract | Exact wire shape |
|---|---|
| `loginRequest` | `pin`: string, 1–64 |
| `loginResponse` | `token`: string 1–8192 |
| `idParams` | `id`: string matching `/^[1-9]\\d*$/` |
| `contact` | positive integer `id`; `phone` string 1–32; nullable `name` up to 255; optional boolean `opted_in`; optional nullable ISO `archived_at` |
| `contactList` | array of `contact` |
| `createContactRequest` | `name`: string up to 255; `phone`: string 1–32 |
| `updateContactRequest` | optional `name` string 0–255 and `phone` string 1–32; `minProperties: 1` |
| `archiveRequest` | `archived`: boolean |

Export `{ schema, validate, contracts }`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all schema, auth, and contact tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/api-contract.js test/api-contract.test.js
git commit -m "feat: define auth and contact contracts"
```

### Task 3: Campaigns

**Files:**
- Modify: `shared/api-contract.js`
- Modify: `test/api-contract.test.js`

- [ ] **Step 1: Write failing campaign tests**

Test every campaign and recipient status, nullable timestamp/media/error fields,
campaign-detail nesting, each response envelope, and a scalar `contactIds`
value producing `{ path: 'contactIds', message: 'Expected an array' }`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because campaign contracts are missing.

- [ ] **Step 3: Implement exact campaign contracts**

| Contract | Exact wire shape |
|---|---|
| `campaign` | positive `id`; `name` 1–200; `body` 1–4000; nullable HTTP(S) `media_url` up to 2048; status enum `draft/scheduled/sending/completed/failed`; nullable ISO `scheduled_at`; non-negative integer counts; nullable `created_by` up to 255; ISO `created_at`; nullable ISO `archived_at` |
| `campaignList` | array of `campaign` |
| `recipientCount` | recipient-status enum and non-negative integer `n` |
| `recipient` | positive `id`; `phone` 1–32; nullable `name` up to 255; recipient-status enum `pending/sent/delivered/failed/opted_out`; nullable `vonage_message_id` up to 255; nullable `error` up to 1000; nullable ISO `sent_at` |
| `campaignDetail` | all campaign fields plus `recipientCounts` and `recipients` arrays |
| `createCampaignRequest` | `name` 1–200; `body` 1–4000; positive-integer `contactIds` array; `phones` array of strings 1–32; nullable ISO `scheduledAt`; nullable HTTP(S) `mediaUrl` up to 2048 |
| `campaignCreatedResponse` | positive integer `id`; non-negative integer `total` |
| `okResponse` | boolean `ok` |
| `archiveCampaignResponse` | boolean `ok`; positive integer `id`; nullable ISO `archived_at` |

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all campaign and foundation tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/api-contract.js test/api-contract.test.js
git commit -m "feat: define campaign API contracts"
```

### Task 4: Suggestion, media, account, and logs

**Files:**
- Modify: `shared/api-contract.js`
- Modify: `test/api-contract.test.js`

- [ ] **Step 1: Write failing tests for every remaining contract**

Include invalid log level, raw string query values (`before: '100'`,
`limit: '50'`), nullable account pricing, both media-conflict options,
object-shaped log metadata with unknown keys, and rejection of `ftp:`/`data:`
URLs for every media URL field.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because the contracts below are missing.

- [ ] **Step 3: Implement exact remaining contracts**

| Contract | Exact wire shape |
|---|---|
| `suggestRequest` / `suggestResponse` | non-empty `prompt` up to 4000 / non-empty `text` |
| `uploadedMedia` | HTTP(S) `url` up to 2048; `filename` 1–255; non-negative `bytes`; non-negative `originalBytes`; `format` enum `jpg/gif` |
| `mediaConflict` | `error` 1–500; literal `conflict: true`; `filename` 1–255; HTTP(S) `existingUrl` up to 2048 |
| `mediaConflictQuery` | optional `onConflict` enum `copy/replace` |
| `accountBalanceResponse` | `balance`: string 1–64; `autoReload`: boolean; nullable `pricePerSegment` string up to 64; nullable `currency` string up to 16 |
| `logEntry` | positive `id`; level enum `info/warn/error`; `category` 1–32; `message` 1–500; nullable object `meta` allowing unknown keys; ISO `created_at` |
| `logPage` | log-entry array; nullable positive integer `nextBefore` |
| `logsQuery` | optional level; optional category enum from `lib/logs.js`; optional positive digit strings `before` and `limit` |

Do not coerce query strings. Route integration will parse them after validation.
Implement HTTP(S) checks with `new URL(value)` and an explicit `http:`/`https:`
protocol allowlist, not a prefix-only regular expression.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: every runtime contract test passes.

- [ ] **Step 5: Commit**

```bash
git add shared/api-contract.js test/api-contract.test.js
git commit -m "feat: define supporting admin API contracts"
```

## Chunk 3: TypeScript contract surface and verification

### Task 5: Declarations and type fixture

**Files:**
- Create: `shared/api-contract.d.ts`
- Create: `admin-ui/src/lib/api-contract.typecheck.ts`
- Modify: `test/api-contract.test.js`

- [ ] **Step 1: Write failing parity and TypeScript fixture checks**

Add a Node test that extracts `ApiContractName` string literals from the future
declaration file and compares them with sorted `Object.keys(contracts)`.

Create `admin-ui/src/lib/api-contract.typecheck.ts` importing from
`../../../shared/api-contract.js`. Exercise inferred login, contact, campaign,
account, and log values. Add `// @ts-expect-error` assertions for a scalar
`contactIds` value and invalid campaign status.

- [ ] **Step 2: Run checks and verify RED**

Run: `npm test`

Run: `cd admin-ui && npx tsc --noEmit`

Expected: both fail because `shared/api-contract.d.ts` is missing.

- [ ] **Step 3: Implement precise declarations**

Create `shared/api-contract.d.ts` with:

- schema node option types and generic `Schema<T>`;
- `Infer<S extends Schema<unknown>>`;
- `ValidationIssue` and `ValidationResult<T>`;
- builder signatures, including optional/nullable/union inference;
- DTO interfaces matching every exact runtime contract above;
- `ApiContractName` as every runtime key;
- `ContractMap`, mapping each name to `Schema<ExactDtoType>`;
- `contracts: ContractMap`;
- `validate<S extends Schema<unknown>>(contract: S, value: unknown): ValidationResult<Infer<S>>`.

The fixture is under the existing `admin-ui/src` include, so TypeScript checks
the external declaration. It is not imported by application code and will not
enter a future bundle.

- [ ] **Step 4: Run checks and verify GREEN**

Run: `npm test`

Run: `cd admin-ui && npx tsc --noEmit`

Expected: runtime/declaration names match and TypeScript exits 0.

- [ ] **Step 5: Verify CommonJS syntax and loading**

Run: `node --check shared/api-contract.js`

Run: `node -e "const api = require('./shared/api-contract'); console.log(Object.keys(api.contracts).length)"`

Expected: syntax exits 0 and loading prints a positive integer.

- [ ] **Step 6: Commit**

```bash
git add shared/api-contract.d.ts admin-ui/src/lib/api-contract.typecheck.ts test/api-contract.test.js
git commit -m "feat: declare shared API contract types"
```

### Task 6: Final non-build verification

**Files:**
- Verify: `shared/api-contract.js`
- Verify: `shared/api-contract.d.ts`
- Verify: `test/api-contract.test.js`
- Verify: `admin-ui/src/lib/api-contract.typecheck.ts`
- Verify: `package.json`

- [ ] **Step 1: Run complete verification**

Run: `npm test`

Run: `node --check shared/api-contract.js`

Run: `cd admin-ui && npx tsc --noEmit`

Expected: every command exits 0. Do not run `npm run build`.

- [ ] **Step 2: Confirm generated assets and unrelated work were untouched**

Run: `git status --short public/admin`

Run: `git diff --stat <starting-commit>..HEAD`

Run: `git log --name-only --format='%h %s' <starting-commit>..HEAD`

Expected: `public/admin` has no changes and the complete implementation range
contains only the plan, contract, test, declaration, type-fixture, and package
files. Compare final `git status --short` with the Task 0 baseline and preserve
all pre-existing modifications and untracked files.
