/**
 * Response shape for the audit-log admin endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/audit.ts`
 *   - `GET /audit/event/:eventId` — page of entries for one event
 *   - `GET /audit/entity/:type/:id` — full history for one entity
 *
 *   Both queries `SELECT al.*, u.name AS user_name, u.email AS user_email`
 *   from `audit_log` left-joined to `users`, so the row shape is identical
 *   for the two endpoints (only the filter and limit differ).
 * - Client: `src/client/components/admin/AuditTab.tsx` (top-level table,
 *   `EntityHistoryModal`, and `DiffModal`).
 *
 * `old_value` / `new_value` are stored as raw text in the database and may
 * contain serialised JSON — the client parses opportunistically. Joined
 * `user_*` fields are `null` when the originating user has been deleted
 * (the FK is `ON DELETE SET NULL`) or the action was performed without a
 * logged-in user.
 */

export interface AuditLogEntry {
  readonly id: number;
  readonly event_id: number | null;
  readonly user_id: number | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: number | null;
  readonly old_value: string | null;
  readonly new_value: string | null;
  readonly ip_address: string | null;
  readonly created_at: string;

  readonly user_name: string | null;
  readonly user_email: string | null;
}

/**
 * Response body of `GET /audit/event/:eventId` and
 * `GET /audit/entity/:type/:id` — a chronologically ordered page of
 * entries (newest first).
 */
export type AuditLogResponse = readonly AuditLogEntry[];
