# Request Validation

Colosseum validates untrusted `body`, `params`, and `query` values at the HTTP
boundary with the in-house schema helper in `src/server/validation/schema.ts`.
Parsed values are typed, unknown keys are rejected on converted mutation
routes, and clients receive structured issues instead of a single string error.

Request schemas do not replace validation that depends on persisted state.
Routes and services must still establish that an event or game exists, that it
owns the referenced resource, that a team participates in a game, and that an
operation is legal in the current workflow state.

The template-defined `scoreData` object is another deliberate boundary. Its
envelope can be checked as a string-keyed record, but its fields cannot be
fully described by a single static schema. Template-aware validation remains a
separate service.

## Schema organization

```text
src/server/validation/
  schema.ts
  errors.ts
  middleware.ts
  primitives.ts
  brackets.ts
  events.ts
  scores.ts
  teams.ts
  ...
```

`schema.ts` is the parser. `primitives.ts` contains small shared policies such
as positive database IDs, trimmed non-empty strings, and ISO date inputs.
Domain files compose those primitives and own their request schemas.

Export inferred types only when code outside the route benefits from them:

```ts
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
```

Do not maintain a separate handwritten request interface alongside its schema.

## Middleware

`validateRequest` / `validatedHandler` parse selected request sections before
the handler performs database work. Parsed values are stored on `req.validated`;
raw Express objects are unchanged.

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

The wrapper infers handler input types from the schemas. Unexpected thrown
errors go to Express error handling instead of becoming validation failures.

## Error contract

Converted routes return a nested object only; there is no compatibility string
`error` field. In-repo clients read `error.message` via `getApiErrorMessage`.
Unconverted routes may still return `{ error: string }`; the helper accepts
both.

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

- Issue `path` values are arrays so field names can contain dots and array
  indexes remain unambiguous.
- Clients should branch on application codes, locations, and paths, not on
  human-readable messages alone.
- Schema and semantic request failures use `400`; `404` for absent resources,
  `403` for authorization failures, and `409` for current-state conflicts.
- Error serialization must never include request values, secrets, SQL, or
  internal stack traces.

Shared constructors live in `src/server/validation/errors.ts`.

## Replacement versus patch

- `PUT` is a full replacement of the editable representation. Score updates
  must send `scoreData` and a complete `resultType` variant.
- `PATCH` is a partial update. Parse the patch's individual fields first, load
  the existing record, merge the patch into a candidate object, and then parse
  that complete candidate with the canonical entity/update schema.
- Do not run a full-state cross-field refinement directly on a partial object.

For a patch, the sequence is:

1. Parse the shape and primitive types of the patch.
2. Load and authorize the existing resource.
3. Merge only explicitly supplied properties.
4. Validate the merged candidate with the complete schema.
5. Run database-dependent business checks.
6. Persist the validated candidate.

## Strictness and coercion

- Strict bodies for same-deployment internal admin mutations, where rejecting a
  typo is more useful than forward compatibility.
- Strict route parameters.
- JSON body values use strict primitives. Do not coerce `"false"` to a boolean.
- Route and query parameters arrive as strings, so bounded coercion is
  appropriate (`coercedPositiveId`).
- Define defaults only where omission has an intentional API meaning.

## Validation layers

| Layer                     | Responsibility                                    | Example                                                      |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Request schema            | Shape, primitive types, local field relationships | `resultType` is a supported value and a DQ includes a reason |
| Domain/service validation | Rules involving state or workflow                 | The DQ team participates in this game                        |
| Database constraints      | Last-line data integrity                          | Foreign keys and allowed `result_type` values                |

Do not move database queries into schema refinements. Parse first, then perform
domain checks in a service that receives typed input.

For `scoreData`, validate the outer record at the request boundary, then
validate its contents against the selected stored template in a dedicated
template-validation step.

## Implemented: Phases 1 and 2

Converted mutation params/bodies (GET list filters remain until Phase 3):

- Score submit, score PUT, accept/revert/bulk-accept, advance-winner
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

`resultType` is required on score submit and update. Score `PUT` is a full
replacement. Unknown keys are rejected. IDs are coerced only on params and
query strings.

## Remaining later work

### Phase 3 — query endpoints

Replace unbounded `parseInt` / `as string` query handling with bounded schemas.
Preserve documented defaults. Prefer **rejecting** invalid filters/enums rather
than silently ignoring them.

Inventory to convert later:

- `GET /scores/by-event/:eventId` — page/limit (already clamped 1–100),
  status/score_type enums
- `GET /audit/event/:eventId` — unbounded `limit`/`offset`
- Chat message list — replace `parseMessagePagination` (max 100)
- Events/teams/queue list filters (`status`, `queue_type`)
- Awards preview query params (`*_top_n`, award types)
- Bracket list `bracket_size` / `eligible`

### Phase 4 — complex / externally sensitive inputs

- Scoresheet templates: HTTP envelope in a request schema; keep
  `validateScoresheetSchema` as the template-aware step.
- `scoreData` contents: stable `ScoreFieldEntry` (`{ value, type?, label? }`);
  validate against the stored template in a dedicated service after the request
  schema.
- Teams bulk import and documentation scores bulk PUT: item-level issues with
  array indexes in `path`.
- Judge submit field contents remain envelope-at-boundary + template service.
- OpenAPI generation remains out of scope.

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
