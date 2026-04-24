/**
 * Response shape for the admin-users listing endpoint.
 *
 * Source of truth for:
 * - Server: `src/server/routes/admin.ts` (`GET /api/admin/users`)
 *   — selects admin rows from the `users` table and decorates each one
 *   with derived activity flags (`isActive`, `isRecentlyActive`,
 *   `tokenValid`) computed against the current wall-clock time.
 * - Client: `src/client/components/admin/AdminsTab.tsx`.
 *
 * The endpoint already filters to `is_admin = true`, so the wire form
 * intentionally omits that column — every entry is, by construction, an
 * admin. `last_activity` is always normalised to an ISO-8601 string by
 * the server (regardless of whether the underlying driver returned a
 * `Date` or a raw timestamp string), so the client can pass it straight
 * to `new Date(...)`.
 */

export interface AdminUser {
  readonly id: number;
  readonly email: string;
  readonly name: string | null;

  /** ISO-8601 timestamp, or `null` if the admin has never been seen. */
  readonly last_activity: string | null;
  readonly created_at: string;
  readonly updated_at: string;

  /** True if `last_activity` is within the last 5 minutes. */
  readonly isActive: boolean;
  /** True if `last_activity` is within the last hour. */
  readonly isRecentlyActive: boolean;
  /** True if the stored OAuth `token_expires_at` is still in the future. */
  readonly tokenValid: boolean;
}

/** Response body of `GET /api/admin/users`. */
export type AdminUserListResponse = readonly AdminUser[];
