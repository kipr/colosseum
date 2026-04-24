/**
 * Response shapes for the chat endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/chat.ts`
 *   - `GET /chat/spreadsheets` → `readonly ChatSpreadsheet[]`: distinct
 *     active rows from `spreadsheet_configs`, surfacing each spreadsheet
 *     once as a chat-room target.
 *   - `GET /chat/messages/:spreadsheetId` → `readonly ChatMessage[]`:
 *     messages for a given spreadsheet chat room, in chronological order.
 *   - `POST /chat/messages` → `ChatMessage`: the just-inserted message.
 *   - `GET /chat/admin/messages` → `readonly ChatMessage[]`: messages in
 *     the admin-only chat room.
 *   - `POST /chat/admin/messages` → `ChatMessage`: the just-inserted
 *     admin-room message.
 *
 *   The server passes every outgoing row through `fixTimestamp()` so
 *   `created_at` is always an ISO-8601 string on the wire (regardless of
 *   whether the underlying driver returned a `Date` or a raw SQLite
 *   timestamp string).  The internal `user_id` column is intentionally
 *   not selected and so does not appear here.
 *
 * - Client: `src/client/contexts/ChatContext.tsx` (and, transitively,
 *   `src/client/components/PublicChat.tsx` via the chat context).
 */

/** One chat room, keyed by its underlying spreadsheet config. */
export interface ChatSpreadsheet {
  readonly spreadsheet_id: string;
  readonly spreadsheet_name: string;
}

/** One message in a chat room. */
export interface ChatMessage {
  readonly id: number;
  readonly spreadsheet_id: string;
  readonly sender_name: string;
  readonly message: string;
  readonly is_admin: boolean;
  /** ISO-8601 timestamp, normalised by the server. */
  readonly created_at: string;
}
