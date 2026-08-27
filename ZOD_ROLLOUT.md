# Zod Rollout Guide

## Purpose

Colosseum's first Zod usage validates the new bracket-result fields and several
related score and bracket mutations. The pilot has been useful: request values
are checked at the HTTP boundary, route parameters are converted to typed
numbers, invalid combinations receive structured errors, and route handlers no
longer need to cast those payloads from `req.body`.

The pilot should not be copied mechanically across every route. The items below
should be completed first so that conversions produce consistent API behavior
instead of a collection of locally correct but incompatible schemas.

The target is **Zod at meaningful runtime boundaries**, not Zod everywhere. See
"Scope decisions" for what is deliberately not being converted, and section 9
for why Zod stays out of the browser bundle.

## Current pilot: what it proves

Zod is a good fit for:

- Validating untrusted `body`, `params`, and `query` values before route logic.
- Converting URL strings into bounded, typed values.
- Enforcing request-local relationships such as "a DQ requires a team and a
  reason."
- Applying explicit defaults, such as treating an omitted result type as a
  standard result during a compatibility period.
- Returning all detectable field errors together rather than failing on the
  first manual condition.

Zod does not replace validation that depends on persisted state. Routes and
services must still establish that an event or game exists, that it owns the
referenced resource, that a team participates in a game, and that an operation
is legal in the current workflow state.

The template-defined `scoreData` object is another deliberate boundary. Its
envelope can be checked with Zod, but its fields cannot be fully described by a
single static schema. Template-aware validation should remain a separate
service unless schemas are generated from stored scoresheet templates.

## Required work before full rollout

### 1. Model conditional payloads as discriminated unions

The current bracket-result schemas use optional fields plus `superRefine()`. It
checks the rules at runtime, but TypeScript still sees
`disqualifiedTeamId` and `resultNote` as optional after parsing. This is why
route code still needs a non-null assertion for a validated DQ.

Represent each legal result shape directly:

```ts
const resultFieldsSchema = z.discriminatedUnion('resultType', [
  z.object({
    resultType: z.literal('standard'),
    disqualifiedTeamId: z.null().optional(),
    resultNote: z.null().optional(),
  }),
  z.object({
    resultType: z.literal('no_contest'),
    disqualifiedTeamId: z.null().optional(),
    resultNote: z.null().optional(),
  }),
  z.object({
    resultType: z.literal('disqualification'),
    disqualifiedTeamId: positiveId,
    resultNote: z.string().trim().min(1).max(1000),
  }),
]);
```

Compose this with the common submission fields. After a successful parse, a
check for `resultType === 'disqualification'` will narrow the other two fields
to their required types.

**Implemented:** `resultType` is required on submit and update. A missing
discriminator is rejected; there is no preprocess default to `standard`.

Use `superRefine()` only for relationships that cannot reasonably be encoded as
a union. Prefer schemas whose inferred TypeScript type represents only valid
states.

### 2. Define replacement and partial-update semantics

The existing score `PUT` requires `scoreData`, but makes the new result fields
optional and merges omitted fields from the stored row. This is a hybrid of
replacement and patch behavior. It also creates a validation problem: Zod
cannot know that a request containing only a new `resultNote` belongs to an
existing DQ until after the row has been loaded.

Adopt the following convention:

- `PUT` is a full replacement of the editable representation. Require the
  complete result variant as well as `scoreData`. This matches the current
  admin editor, which submits the full result state.
- `PATCH` is a partial update. Parse the patch's individual fields first, load
  the existing record, merge the patch into a candidate object, and then parse
  that complete candidate with the canonical entity/update schema.
- Do not run a full-state cross-field refinement directly on a partial object.

For a patch, the sequence should be:

1. Parse the shape and primitive types of the patch.
2. Load and authorize the existing resource.
3. Merge only explicitly supplied properties.
4. Validate the merged candidate with the complete discriminated union.
5. Run database-dependent business checks.
6. Persist the validated candidate.

Document the selected semantics in route tests and the API documentation before
converting existing update endpoints.

### 3. Organize schemas by API domain

`validation/bracketResult.ts` currently includes bracket-result schemas as well
as generic accept, revert, bulk-accept, and route-parameter schemas. That layout
will become difficult to navigate during a wider rollout.

Use a structure such as:

```text
src/server/validation/
  errors.ts
  middleware.ts
  primitives.ts
  brackets.ts
  events.ts
  scores.ts
  teams.ts
  templates.ts
```

`primitives.ts` should contain small policies that are truly shared, for
example positive database IDs, bounded pagination, trimmed non-empty strings,
and ISO date inputs. Domain files should compose those primitives and own their
request schemas.

Primitives shared between the request schemas and the scoresheet document model
(`positiveId`, `trimmedNonEmptyString`) live in
`src/shared/validationPrimitives.ts` and are re-exported from
`src/server/validation/primitives.ts`. Despite living under `src/shared`, that
module is Zod-based and therefore server-side; the client must not import its
values.

The scoresheet _document_ model is split: Zod schemas and inferred types in
`src/shared/scoresheetSchema.ts`, Zod-free constants and helpers in
`src/shared/scoresheetDocument.ts` (see section 9). The HTTP _envelope_ for
template create/update (`name`, `description`, `accessCode`, `eventId`,
`schema`) lives in `src/server/validation/templates.ts` and is applied through
`validatedHandler`.

Avoid a single global schema collection and avoid abstractions that merely save
one line. A developer should be able to find a route's schema from the route's
domain and name, such as `updateScoreBodySchema` or
`listScoresQuerySchema`.

Export inferred types only when code outside the route benefits from them:

```ts
export type UpdateScoreBody = z.infer<typeof updateScoreBodySchema>;
```

Do not maintain a separate handwritten request interface alongside its schema;
the two will eventually drift.

### 4. Add route validation middleware

The pilot repeats `parseRequest(...)` followed by a null check for each request
section. Introduce middleware that can validate `params`, `query`, and `body`
and expose their parsed results under one consistently typed location.

The middleware must:

- Parse before the handler performs database work.
- Preserve Zod transformations and defaults in the value the handler reads.
- Identify whether an issue came from `params`, `query`, or `body`.
- Return immediately after sending a validation response.
- Support schemas for one, two, or all three request sections.
- Avoid mutating raw Express objects in surprising ways. Prefer a typed
  `req.validated` property or a small handler wrapper.
- Pass thrown or unexpected errors to Express error handling instead of
  converting them into validation failures.

A target route should read conceptually like this:

```ts
router.put(
  '/:id',
  requireAuth,
  validateRequest({ params: scoreIdParamsSchema, body: updateScoreBodySchema }),
  async (req, res) => {
    const { id } = req.validated.params;
    const payload = req.validated.body;
    // Authorization and business validation follow.
  },
);
```

Implement and prove the wrapper on the pilot routes before using it elsewhere.
The exact TypeScript design can differ, but it must infer handler input types
without falling back to `any` or requiring duplicate casts.

### 5. Establish one API error contract

The pilot returns a top-level string error plus Zod issues, while business
checks often return only a string error. Clients should not have to special-case
where validation happened.

Adopt one shape for expected client errors. For example:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid values.",
    "issues": [
      {
        "location": "body",
        "path": ["resultNote"],
        "code": "too_small",
        "message": "A private reason is required."
      }
    ]
  }
}
```

Decide and document:

- Whether paths are arrays or dot-separated strings. Arrays are preferable
  because field names can contain dots and array indexes remain unambiguous.
- Stable application error codes. Do not make clients branch on human-readable
  messages or raw Zod issue codes alone.
- Status-code policy. Keeping schema and semantic request failures at `400`
  initially minimizes compatibility changes; use `404` for absent resources,
  `403` for authorization failures, and `409` for current-state conflicts.
- Whether all Zod issues are exposed. They are safe for ordinary input schemas,
  but error serialization must never include request values, secrets, SQL, or
  internal stack traces.
- How the client maps issue paths to form controls and presents a fallback
  message for errors without a matching field.

Create shared server constructors for validation, not-found, forbidden, and
conflict responses. **Implemented (off-season):** converted routes use the
nested object only; there is no compatibility string `error` field. In-repo
clients read `error.message` via `getApiErrorMessage`. Unconverted routes may
still return `{ error: string }`; the helper accepts both.

### 6. Create a repeatable validation test matrix

Every mutation schema should have focused unit tests, plus a smaller number of
HTTP integration tests proving middleware and route behavior.

Schema unit tests should cover:

- The smallest valid request.
- A fully populated valid request.
- Every discriminator variant.
- Missing required fields.
- Wrong primitive types; for example strings where JSON numbers are required.
- Boundary values such as ID `0`, negative IDs, empty strings, maximum lengths,
  and pagination limits.
- Unknown keys according to that endpoint's compatibility policy.
- Defaults, coercions, and trimming.
- Each invalid cross-field combination.
- Multiple simultaneous errors and their paths.

HTTP tests should cover:

- Validation occurs before database mutation or downstream service calls.
- The agreed response status and serialized error contract.
- Auth middleware order remains correct. In particular, unauthenticated callers
  must not gain payload details from protected routes if authentication is
  intended to run first.
- Parsed/coerced values, rather than the raw request values, reach route logic.
- Database-aware rules still run after schema validation.
- A rejected request leaves the database and audit log unchanged.

Prefer table-driven tests for primitive and variant cases. Do not assert full
English error text everywhere; assert stable application codes, locations,
paths, and important boundary behavior.

Before rollout, add direct coverage for all pilot schemas, including score
update, accept, revert, bulk accept, and winner advancement. The current pilot
has strong integration coverage for score submission but does not exercise all
invalid cases of the smaller schemas.

### 7. Choose strictness and coercion policies deliberately

Calling `.strict()` on every object catches misspelled properties, but it also
causes an older server to reject a request from a newer client that includes an
additive field. This matters during rolling deployments or when judge clients
remain open across a deployment.

Use the following default policy:

- Strict bodies for same-deployment internal admin mutations where rejecting a
  typo is more useful than forward compatibility.
- Consider stripping unknown body keys for judge-facing or independently
  versioned clients when additive compatibility is important.
- Strict route parameters.
- Explicit query schemas that strip or reject unknown filters according to the
  endpoint documentation.

Choose coercion by transport location:

- Route and query parameters arrive as strings, so bounded coercion is
  appropriate.
- JSON body values should normally use strict primitives. Silently converting
  `"false"` with general Boolean coercion is especially dangerous because a
  non-empty string is truthy.
- Define defaults only where omission has an intentional API meaning. Do not
  use defaults to conceal a required client decision.

Record exceptions next to the schema. Consistency is valuable, but transport
and compatibility constraints are more important than applying one policy
universally.

### 8. Separate structural, domain, and persistence validation

Use three explicit layers:

| Layer                     | Responsibility                                    | Example                                                      |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Request schema            | Shape, primitive types, local field relationships | `resultType` is a supported value and a DQ includes a reason |
| Domain/service validation | Rules involving state or workflow                 | The DQ team participates in this game                        |
| Database constraints      | Last-line data integrity                          | Foreign keys and allowed `result_type` values                |

Do not move database queries into Zod refinements. Async refinements obscure
query count, transaction boundaries, authorization order, and error mapping.
Parse first, then perform domain checks in a service that receives typed input.

Where the same domain rule is used by submit, edit, accept, and import flows,
centralize it in a service rather than duplicating it in route handlers. Zod
should make that service's input trustworthy; it should not become the service.

For `scoreData`, continue to validate the outer record at the request boundary,
then validate its contents against the selected stored template in a dedicated
template-validation step. Define a stable internal representation for field
entries so routes do not repeatedly inspect `{ value, type, label }` using
`unknown` and `any`.

### 9. Decide how schemas are shared with the client and documentation

**Zod is a server-side dependency and must not reach the browser bundle.**

An earlier revision of this section accepted Zod in the client, reasoning that
the admin editor needed issue paths before a round trip and that the portable
exporter had to agree on one field model. Neither materialized. The editor in
`src/client/components/admin/TemplateEditorModal.tsx` does a bare `JSON.parse`,
posts, and discards the server's structured issues behind a generic `alert`.
The exporter in `tools/portable-scoresheet/export-html.mjs` never imported the
shared module at all. The client called no parser, yet paid an 88.5 kB raw /
24.0 kB gzipped chunk for the Zod runtime, because six Zod-free helpers happened
to live alongside the schema builders.

The scoresheet document model is therefore split in two:

- `src/shared/scoresheetDocument.ts` — no Zod. Constants, primitive types,
  value guards (`isPlainObject`, `isScoresheetValue`, `discriminateShape`), and
  field helpers (`getFieldDefaultValue`, `getBlankFieldValue`,
  `isRepeatableGroupField`). The client imports values from here.
- `src/shared/scoresheetSchema.ts` — the canonical Zod schemas, the inferred
  types, and the parse/validate entry points. It re-exports the Zod-free
  helpers for server and script callers, which already depend on Zod.

Types stay inferred from the schemas; there is no second handwritten copy of
the document model. The client reaches them with `import type`, which is erased
at compile time, so the canonical schema remains the single source of truth
without any runtime cost.

Two guards keep this from silently regressing, because a type-only import
becoming a value import produces no visible error:

- A `src/client/**` block in `eslint.config.mjs` sets
  `@typescript-eslint/no-restricted-imports` with `allowTypeImports: true`. Type
  imports from the schema modules are allowed; value imports, and any import of
  `zod`, are rejected.
- `scripts/check-client-bundle.mjs` runs as part of `build:client` and fails if
  any emitted chunk contains Zod runtime markers. This catches re-entry through
  a transitive dependency or an `eslint-disable`, which lint alone cannot.

Client-side runtime parsing is justified only for a complex persisted document
or a genuinely critical response, not for CRUD responses from this same
deployment. `src/shared/apiError.ts` is the pattern to follow for transport
concerns: a small handwritten module with no validation library in it. If the
admin editor later wants real issue paths before a round trip, load the schema
with a dynamic `await import()` so the cost is confined to that one route.

After the server conventions stabilize, consider generating OpenAPI from the
canonical schemas or adding schema descriptions used by documentation. Treat
generation as a later optimization, not a prerequisite for validating routes.
Verify that any selected generator supports Zod 4 and the refinements and
transformations used by the project.

## Implemented: Phases 1 and 2

Phases 1 and 2 are in the codebase. Off-season: there is no old-client
compatibility layer. Converted routes use a nested `{ error: { code, message,
issues? } }` contract, require `resultType` on score submit/update, treat score
`PUT` as full replacement, reject unknown keys, and coerce IDs only on params
and query strings.

**Phase 1 (pilot hardened)**

- Discriminated `resultType` union; `resultType` is required (no preprocess to
  `standard`).
- Score `PUT /scores/:id` is a full replacement of the editable representation.
- Typed `validateRequest` / `validatedHandler` middleware with `req.validated`.
- Nested error constructors in `src/server/validation/errors.ts`.
- Schemas split by domain under `src/server/validation/`.
- Pilot routes: score submit, score PUT, accept/revert/bulk-accept,
  advance-winner.

**Phase 2 (low-risk admin mutations)**

Converted mutation params/bodies (GET list filters remain until Phase 3):

- Events create / patch / delete (PATCH parse-load-merge-revalidate)
- Teams create / patch / check-in / bulk check-in / delete (not bulk import)
- Queue create / presence / status-table patch / call / delete /
  populate-from-seeding / populate-from-bracket
- Seeding score create / patch / delete
- Remaining scores reject / un-reject (`/:id/revert`) / delete
- Simple bracket create / patch / delete
- Awards template, event-award, and recipient CRUD (not automatic-award
  preview query params)
- Chat post / delete conversation
- Double-seeding generate / delete-all / delete-round

## Remaining later work

### Phase 3 — query endpoints, narrowed

Phase 3 is **not** a completeness goal. Converting every query endpoint for
uniformity buys compile-time tidiness on values that are already read through a
clamp or a narrow `if`, and it adds a schema to maintain per endpoint. Convert a
query endpoint only where a bound or an enum prevents a real bug.

Where a schema is added, preserve documented defaults, and prefer **rejecting**
invalid filters and enums over silently ignoring them. Note any remaining
ignore/default exception next to the schema.

Worth converting — unbounded numbers reaching SQL, or enums that silently widen
a result set:

- `GET /audit/event/:eventId` — unbounded `limit` / `offset`
- Chat message list — replace `parseMessagePagination` (max 100)
- `GET /scores/by-event/:eventId` — `status` / `score_type` enums; page and
  limit are already clamped 1–100, so the enums are the reason to do this one

Deliberately not converting. These read one or two values, already behave
correctly on garbage input, and gain nothing but a second place to look:

- Events / teams / queue list filters (`status`, `queue_type`)
- Awards preview query params (`*_top_n`, award types)
- Bracket list `bracket_size` / `eligible`

### Phase 4 — complex / externally sensitive inputs

- Scoresheet templates: canonical document model is a Zod schema in
  `src/shared/scoresheetSchema.ts`. `validateScoresheetSchema` remains the
  exported template-aware step; its body is a Zod parse. HTTP envelopes live
  in `src/server/validation/templates.ts` and are applied through
  `validatedHandler`. Stored JSON is loaded with normalize-then-strict parse.
- `scoreData` contents: stable `ScoreFieldEntry` (`{ value, type?, label? }`);
  validate against the stored template in a dedicated service after the request
  schema.
- Teams bulk import and documentation scores bulk PUT: item-level issues with
  array indexes in `path`.
- Judge submit field contents remain envelope-at-boundary + template service.
- Monitor failures by `code` + route; log metadata only (never scoresheets,
  access codes, session material, or DQ notes).
- OpenAPI generation remains out of scope.

## Scope decisions

The endpoint of this rollout is **Zod at meaningful runtime boundaries**, not
Zod everywhere. Value is concentrated in a few places and thins out quickly:

| Area                                             | Value  | Status           |
| ------------------------------------------------ | ------ | ---------------- |
| Scoresheet/template documents and stored JSON    | High   | Done, keep       |
| Judge score submissions, queue/bracket mutations | High   | Done, keep       |
| Ordinary admin CRUD request bodies               | Modest | Done, keep as-is |
| Client-side validation of same-server responses  | Low    | Not doing        |

Zod earns its place where the data is nested, dynamic, persisted, or migrated
from a legacy shape, and where a discriminated union can make an impossible
state unrepresentable — an incomplete disqualification, a mismatched queue type.
It does not verify that a team belongs to a match, that an operation is legal at
the current tournament stage, or that a calculated score is correct. Database
constraints and service-level rules remain more important for those.

Explicitly out of scope:

- **No client-side validation of responses from this same server.** Client and
  server ship together, so re-parsing a teams, queue, or bracket response offers
  little beyond the compile-time transport type. See section 9.
- **No ad-hoc schemas defined inside React components.** Schemas stay
  centralized under `src/server/validation/` and `src/shared/`.
- **No Zod in the browser bundle.** Enforced by lint and by
  `scripts/check-client-bundle.mjs`.
- **No query-endpoint conversion for uniformity.** See the narrowed Phase 3.
- **No removal of the existing server middleware.** With 15 route modules
  wired through `validatedHandler`, unwinding it would cost more than it
  returns and would leave a less coherent system. The request boundary stays.
- **No OpenAPI generation.**

## Definition of done for each converted route

A route is considered migrated only when:

- Every untrusted request section it consumes is parsed by a named schema.
- The handler uses parsed output and contains no redundant request casts.
- Replacement versus patch semantics are explicit.
- Unknown-key, coercion, trimming, and default behavior are intentional.
- Structural validation is not mixed with authorization or database queries.
- Expected failures use the common error contract.
- Unit tests cover schema boundaries and variants.
- HTTP tests prove middleware ordering and no mutation on invalid input.
- API documentation and client payloads match the schema.
- Lint, formatting, tests, and production builds pass.

## Full-rollout readiness checklist

Phase 1–2 items completed by this rollout:

- [x] The bracket-result union narrows correctly without non-null assertions.
- [x] Score update semantics are documented and enforced consistently.
- [x] Typed validation middleware has been proven on body, params, and query.
- [x] A stable, client-consumable error contract is tested.
- [x] Strictness and coercion defaults are documented.
- [x] Pilot schemas are organized by domain.
- [x] Every pilot schema has boundary and invalid-variant tests.
- [x] Database-aware validation remains in services with typed inputs.
- [x] At least one additional low-risk domain has been migrated successfully.
- [x] Full formatting, lint, test, and build verification passes.
- [x] The client bundle contains no Zod runtime, enforced by lint and build.
- [x] The rollout has a stated endpoint and a documented out-of-scope list.

Still open, narrowed:

- [ ] Audit list and chat pagination use bounded schemas.
- [ ] `GET /scores/by-event/:eventId` rejects invalid `status` / `score_type`.
- [ ] Dynamic scoresheet validation has an explicit strategy.
- [ ] Bulk import and documentation-score bulk PUT report item-level issues.

Closed as not-planned: query/pagination/filter conversion across the remaining
list endpoints, and client-side response validation.

## Expected payoff

With these foundations, the main benefit of Zod will not be fewer lines of
validation code. It will be one executable contract at each API boundary:
runtime rejection of malformed input, inferred TypeScript types inside the
handler, predictable client errors, and tests focused on declared behavior.

Without the foundation work, a broad rollout would still improve primitive
checking but would preserve inconsistent errors, ambiguous updates, duplicated
business rules, and schemas that do not fully narrow their types. Completing
Phase 1 first is what turns the pilot from a local safety improvement into a
maintainable API convention.

The counterpart is knowing when to stop. Beyond the server request boundary the
curve flattens, and past it — re-validating this server's own responses in the
browser — it goes negative, trading bundle weight and a second definition for
guarantees the transport type already gave. "Zod everywhere" was never the goal.
