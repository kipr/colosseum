/**
 * Response shape for the current-user endpoint.
 *
 * Source of truth for:
 * - Server: `src/server/routes/auth.ts` (`GET /auth/user`)
 *   — produced by mapping the passport-deserialised user (snake_case
 *   `is_admin`) into the camelCase `isAdmin` wire form.
 * - Client: `src/client/contexts/AuthContext.tsx` (the `user` field on
 *   the auth context).
 *
 * Note: the server-internal passport user object (a row from the `users`
 * table, with snake_case columns) is intentionally *not* shared here.
 * This DTO describes only what crosses the wire.
 */

export interface AuthUser {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly isAdmin: boolean;
}
