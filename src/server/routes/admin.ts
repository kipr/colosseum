import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import type { AdminUser, AdminUserListResponse } from '../../shared/api';

const router = express.Router();

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RECENTLY_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

interface AdminUserRow {
  id: number;
  email: string;
  name: string | null;
  token_expires_at: number | null;
  last_activity: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toEpochMs = (value: Date | string | null): number | null => {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
};

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const toAdminUser = (row: AdminUserRow, now: number): AdminUser => {
  const lastActivityMs = toEpochMs(row.last_activity);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    last_activity:
      lastActivityMs === null ? null : new Date(lastActivityMs).toISOString(),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    isActive:
      lastActivityMs !== null && now - lastActivityMs < ACTIVE_WINDOW_MS,
    isRecentlyActive:
      lastActivityMs !== null &&
      now - lastActivityMs < RECENTLY_ACTIVE_WINDOW_MS,
    tokenValid: row.token_expires_at !== null && row.token_expires_at > now,
  };
};

router.get('/users', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();

    const rows = (await db.all(`
      SELECT
        id,
        email,
        name,
        token_expires_at,
        last_activity,
        created_at,
        updated_at
      FROM users
      WHERE is_admin IS TRUE
      ORDER BY last_activity DESC NULLS LAST
    `)) as AdminUserRow[];

    const now = Date.now();
    const body: AdminUserListResponse = rows.map((row) =>
      toAdminUser(row, now),
    );

    res.json(body);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

export default router;
