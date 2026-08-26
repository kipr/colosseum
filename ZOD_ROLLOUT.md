# Zod Rollout Guide

## Purpose

Colosseum's first Zod usage validates the new bracket-result fields and several
related score and bracket mutations. The pilot has been useful: request values
are checked at the HTTP boundary, route parameters are converted to typed
numbers, invalid combinations receive structured errors, and route handlers no
longer need to cast those payloads from `req.body`.

The pilot should not yet be copied mechanically across every route. The items
below should be completed first so that a full rollout produces consistent API
behavior instead of a collection of locally correct but incompatible schemas.

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

For backward compatibility, normalize a missing result type to `standard`
before parsing the union. Keep that compatibility transformation outside the
canonical union and document when it can be removed. New clients should always
send the discriminator.

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
conflict responses. Migrate the public response contract separately if existing
clients depend on `{ "error": "message" }`; a temporary compatibility field is
preferable to an unannounced breaking change.

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

The current dependency is server-side, so it does not increase the browser
bundle. Keep server schemas server-only unless client runtime validation has a
specific benefit.

For compile-time sharing, prefer small transport types or generated API types
over importing server modules into React code. Importing a schema into the
client should be intentional because it adds runtime code to the bundle and can
couple deployment compatibility more tightly.

After the server conventions stabilize, consider generating OpenAPI from the
canonical schemas or adding schema descriptions used by documentation. Treat
generation as a later optimization, not a prerequisite for validating routes.
Verify that any selected generator supports Zod 4 and the refinements and
transformations used by the project.

## Recommended rollout sequence

### Phase 1: harden the pilot

1. Replace bracket-result refinements with a discriminated union.
2. Make score `PUT` explicitly full-replacement, or introduce `PATCH` using the
   parse-load-merge-revalidate sequence.
3. Define the error contract and compatibility strategy.
4. Implement typed request-validation middleware.
5. Reorganize the current schemas by domain.
6. Add the missing schema and HTTP validation tests.

Do not begin broad route conversion until this phase is complete; otherwise the
same migration will need to be repeated across every endpoint.

### Phase 2: low-risk mutation routes

Convert small admin mutations with simple bodies and parameters, one domain at
a time. Good candidates are status changes, queue operations, and CRUD create
or update routes that already have clear replacement semantics.

For each converted domain:

1. Inventory the accepted request behavior from route code and tests.
2. Identify accidental behavior that should not become part of the contract.
3. Add characterization tests before changing validation.
4. Add schemas and middleware.
5. Remove redundant casts and manual structural checks.
6. Retain authorization and database-dependent checks.
7. Run the full test and build suite.

### Phase 3: query endpoints

Add bounded schemas for pagination, sorting, filters, and IDs. Preserve existing
documented defaults. Decide whether invalid filters should be rejected rather
than silently ignored; changing that behavior may require client updates.

This phase should eliminate patterns such as unbounded `parseInt()` calls and
handwritten enum checks while preventing excessive page sizes.

### Phase 4: complex and externally sensitive inputs

Convert template creation, scoresheet data, bulk imports, and judge-facing
flows last. These endpoints have dynamic data or greater compatibility risk and
need domain-specific design rather than generic object schemas.

Monitor validation failures by application error code and route during rollout.
Log only safe metadata, never full scoresheets, access codes, session material,
or private DQ notes.

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

Begin repo-wide adoption when all of the following are true:

- [ ] The bracket-result union narrows correctly without non-null assertions.
- [ ] Score update semantics are documented and enforced consistently.
- [ ] Typed validation middleware has been proven on body, params, and query.
- [ ] A stable, client-consumable error contract is tested.
- [ ] Strictness and coercion defaults are documented.
- [ ] Pilot schemas are organized by domain.
- [ ] Every pilot schema has boundary and invalid-variant tests.
- [ ] Database-aware validation remains in services with typed inputs.
- [ ] Dynamic scoresheet validation has an explicit strategy.
- [ ] At least one additional low-risk domain has been migrated successfully.
- [ ] Full formatting, lint, test, and build verification passes.

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
