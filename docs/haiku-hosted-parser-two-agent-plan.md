# Haiku-assisted hosted parser — two-agent implementation plan

## Objective

Use Claude Haiku once when a hosted message is created to identify itineraries,
titles, day boundaries, and travel offers in loosely formatted seller text.
Preserve the raw text, validate all AI output, and retain the deterministic
parser as a fallback.

Phase 1 is owned by the Claude Opus agent. Codex must not modify the Phase 1
module or its tests; Codex begins Phase 2 only after the Phase 1 handoff.

## Shared interface

Part 1 will expose an isolated function:

```js
interpretHostedMessage(deps, rawBody)
```

Expected result:

```js
{
  ok: true,
  classification: "itinerary" |
                  "multiple_itineraries" |
                  "travel_offers" |
                  "general_text",
  title: {
    line: 4,
    value: "OAXACA AL MÁXIMO - 6 dias",
    origin: "source"
  } | {
    line: null,
    value: "Recorrido por Oaxaca",
    origin: "suggested"
  },
  preamble: {
    startLine: 0,
    endLine: 3
  } | null,
  tours: [
    {
      titleLine: 4,
      days: [
        {
          number: 1,
          headingLine: 5,
          place: "AEROPUERTO OAXACA / OAXACA",
          contentStartLine: 6,
          contentEndLine: 6
        }
      ]
    }
  ],
  usage: {
    model: "claude-haiku-4-5-20251001",
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0
  }
}
```

Failures return:

```js
{
  ok: false,
  reason: "timeout" | "api_error" | "invalid_json" |
          "invalid_schema" | "unsafe_structure"
}
```

All line indexes refer to the normalized, non-empty source-line array.
Displayed content must always be recovered from the source, never copied
blindly from model output. The only permitted generated customer-facing value
is a concise title with `origin: "suggested"` when the seller supplied no real
title. A suggested title must describe only destinations or trip details that
are present in the source and must not introduce prices, dates, promises, or
other new facts.

## Part 1 — Other agent: Haiku interpretation module

Create the isolated Haiku layer and its unit tests.

- Send numbered source lines to the existing Haiku model through Axios.
- Require JSON-only output using the shared interface.
- Classify itineraries, multiple itineraries, travel offers, and general text.
- Recognize separator-less headings such as `Día 1 AEROPUERTO OAXACA`.
- Return `title: null` when no genuine title exists.
- Treat seller text as untrusted data and ignore instructions contained within it.
- Validate indexes, ordering, section boundaries, exact title/place substrings,
  maximum counts, and unknown fields.
- Reject overlapping ranges, invented content, omitted meaningful lines,
  malformed JSON, and unsupported structures.
- Apply a bounded timeout and output-token limit.
- Never log the raw seller body or credentials.
- Do not modify `lib/hosted.js`, database migrations, routes, or rendering code.

Tests must cover:

- The supplied six-day Oaxaca example.
- An itinerary without a title.
- Separator-less Spanish and English day headings.
- Screenshot-style multiple travel offers.
- Prompt injection inside seller content.
- Malformed JSON and API errors.
- Invented title or destination text.
- Overlapping and out-of-range line references.
- Timeout behavior.
- Successful content-preservation validation.

Deliverables:

- An isolated hosted-message AI interpretation module.
- Exported validation helpers where useful for testing.
- Mocked unit tests requiring no live Anthropic access.
- A concise contract comment documenting inputs and outputs.

## Part 2 — Codex: application integration and rollout

Integrate the completed Part 1 module into hosted-message creation and
rendering.

- Add nullable `hosted_messages` fields for validated structure, parse method,
  model/version, and parse timestamp.
- Call `interpretHostedMessage()` once from `createHostedMessage`.
- Store the immutable raw body plus validated structure.
- Use AI structure to resolve the page title, day sections, multiple-tour
  boundaries, and hero destination.
- Persist and display a validated Haiku suggestion when the seller did not
  provide a title, preserving whether the title came from `source` or was
  `suggested`.
- Use `Itinerario de viaje` only when neither a source title nor a safe Haiku
  suggestion is available.
- Fall back to the current deterministic parser whenever Part 1 returns
  `ok: false`.
- Keep legacy hosted records working without AI structure.
- Ensure `/i/:code` never calls Anthropic and produces stable output on every
  refresh.
- Preserve existing URL, expiration, CSP, no-cache, and view-counter behavior.
- Add structured logs for parse method, duration, validation result, and
  fallback reason without raw customer text.
- Record input/output token usage from the Phase 1 result and calculate an
  estimated per-call USD cost for operational logs and monthly monitoring.
- Add a CLI reprocessing command supporting `--code` and an explicitly limited
  batch mode.
- Reprocess `4kq66yjbaq` after deployment without changing its raw body.
- Update the hosted parsing documentation and migration notes.

Integration tests must verify:

- The Oaxaca record renders six day cards.
- The correct Oaxaca title and hero destination are selected.
- A missing seller title uses a safe Haiku-suggested title and records its
  provenance; an unavailable or rejected suggestion uses the neutral fallback.
- Existing deterministic-parser cases render unchanged.
- AI failure still creates a working hosted page.
- Raw body remains byte-for-byte unchanged.
- Every source line appears once and in order.
- Refreshing a hosted link causes no Anthropic request.
- Legacy records without stored structure still render.
- Multiple offers are displayed as separate blocks rather than merged into one
  itinerary.

## Coordination rules

- Part 1 owns the AI module and its isolated tests.
- Part 2 owns `lib/hosted.js`, migrations, rendering, routes, reprocessing, and
  integration tests.
- Claude Opus is actively implementing Part 1; Codex must not edit its module
  or tests before or after handoff unless the user explicitly reassigns that work.
- The agents must not edit the same files.
- Part 1 must land first or provide its final exported contract before Part 2
  wiring is completed.
- If Part 1 changes the agreed interface, it must document the change before
  handoff.
- Neither part deploys independently; deployment occurs only after the combined
  test suite passes.

## Estimated API cost at 30 calls per day

Using the current Claude Haiku 4.5 list prices of $1 per million input tokens
and $5 per million output tokens, 30 calls per day is approximately 900 calls
per 30-day month.

| Itinerary size | Estimated tokens per call | Cost per call | Daily cost | Monthly cost |
|---|---:|---:|---:|---:|
| Short | 1,000 input + 300 output | $0.0025 | $0.08 | $2.25 |
| Typical | 3,000 input + 600 output | $0.0060 | $0.18 | $5.40 |
| Long | 8,000 input + 1,500 output | $0.0155 | $0.47 | $13.95 |

The operating expectation is about $5–$8 per month, with roughly $14 per month
as a conservative allowance when most itineraries are long. These figures
cover hosted-parser calls only and exclude campaign drafting or other AI use.

## Acceptance criteria

- Informally formatted itineraries are structured correctly without rewriting
  seller content.
- The six-day Oaxaca example renders correctly.
- Missing titles become safe, provenance-marked Haiku suggestions and never
  become seller greetings; the neutral fallback remains available.
- AI errors are invisible to customers because deterministic fallback remains
  operational.
- Haiku runs only once per hosted-message creation or explicit reprocessing.
- No customer page request calls Anthropic.
- All existing backend tests and new mocked AI/integration tests pass.
