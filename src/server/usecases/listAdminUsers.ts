import type { Database } from '../database/connection';

export interface ListAdminUsersParams {
  db: Database;
  /**
   * Reference time in ms-since-epoch used to compute activity flags.
   * Defaults to `Date.now()`; injectable for deterministic tests.
   */
  now?: number;
}

interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  token_expires_at: number | null;
  last_activity: string | Date | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

export interface AdminUserWithStatus extends Omit<
  AdminUserRow,
  'last_activity'
> {
  last_activity: string | null;
  isActive: boolean;
  isRecentlyActive: boolean;
  tokenValid: boolean;
}

export type ListAdminUsersResult = {
  ok: true;
  users: AdminUserWithStatus[];
};

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 60 * 1000;

function lastActivityMs(value: string | Date | null): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/**
 * List all admin users with derived activity flags. The DB layer returns
 * Date objects on PostgreSQL and strings on SQLite, both of which are
 * normalized to ISO strings here.
 */
export async function listAdminUsers(
  params: ListAdminUsersParams,
): Promise<ListAdminUsersResult> {
  const { db, now = Date.now() } = params;

  const users = await db.all<AdminUserRow>(`
    SELECT 
      id, 
      email, 
      name, 
      is_admin,
      token_expires_at,
      last_activity,
      created_at,
      updated_at
    FROM users 
    WHERE is_admin IS TRUE
    ORDER BY last_activity DESC NULLS LAST
  `);

  const usersWithStatus = users.map((user): AdminUserWithStatus => {
    const lastMs = lastActivityMs(user.last_activity);
    return {
      ...user,
      last_activity: lastMs ? new Date(lastMs).toISOString() : null,
      isActive: lastMs ? now - lastMs < ACTIVE_WINDOW_MS : false,
      isRecentlyActive: lastMs ? now - lastMs < RECENT_WINDOW_MS : false,
      tokenValid: user.token_expires_at ? user.token_expires_at > now : false,
    };
  });

  return { ok: true, users: usersWithStatus };
}
