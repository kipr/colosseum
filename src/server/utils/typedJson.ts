import type { Response } from 'express';

/**
 * Send `body` as JSON, asserting at the call site that it has type `T`.
 *
 * This is a thin wrapper around `res.json` whose only job is to make the
 * commitment to a shared response DTO explicit and grep-able. Because TS
 * applies excess-property checks to fresh object/array literals passed
 * through a generic, mistakes like a renamed column or a missing field
 * surface here instead of as silent `undefined` on the client.
 *
 * Pair with a typed mapper that produces `T` from raw DB rows; see
 * `src/server/routes/seeding.ts` for the canonical example and
 * `src/shared/api/README.md` for the full pattern.
 */
export function typedJson<T>(res: Response, body: T): Response {
  return res.json(body);
}
