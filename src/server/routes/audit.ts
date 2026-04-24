import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase, Database } from '../database/connection';
import { typedJson } from '../utils/typedJson';
import type { AuditLogEntry, AuditLogResponse } from '../../shared/api';

const router = express.Router();

// ---------------------------------------------------------------------------
// Typed row → DTO mapper for the wire-typed endpoints below.
// `AuditLogRow` mirrors the shared `SELECT` list 1:1, including the joined
// `u.name AS user_name` / `u.email AS user_email` display columns. The
// mapper is the one place that turns a decoded DB row into the shared
// `AuditLogEntry` DTO, so a renamed column or dropped JOIN field fails
// to compile here instead of silently shipping `undefined`.
// ---------------------------------------------------------------------------

interface AuditLogRow {
  readonly id: number;
  readonly event_id: number | null;
  readonly user_id: number | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: number | null;
  readonly old_value: string | null;
  readonly new_value: string | null;
  readonly ip_address: string | null;
  // SQLite returns a string, PostgreSQL returns a Date; normalised below so
  // the wire shape is always a string regardless of driver.
  readonly created_at: Date | string;
  readonly user_name: string | null;
  readonly user_email: string | null;
}

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const toAuditLogEntry = (row: AuditLogRow): AuditLogEntry => ({
  id: row.id,
  event_id: row.event_id,
  user_id: row.user_id,
  action: row.action,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  old_value: row.old_value,
  new_value: row.new_value,
  ip_address: row.ip_address,
  created_at: toIsoString(row.created_at),
  user_name: row.user_name,
  user_email: row.user_email,
});

// Explicit column list shared by both GET endpoints; mirrors `AuditLogRow`.
const AUDIT_LOG_SELECT = `
  SELECT al.id, al.event_id, al.user_id, al.action, al.entity_type,
         al.entity_id, al.old_value, al.new_value, al.ip_address, al.created_at,
         u.name AS user_name, u.email AS user_email
  FROM audit_log al
  LEFT JOIN users u ON al.user_id = u.id
`;

// GET /audit/event/:eventId - Get audit log for event
router.get(
  '/event/:eventId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const { limit, offset, action, entity_type } = req.query;
      const db = await getDatabase();

      let query = `${AUDIT_LOG_SELECT} WHERE al.event_id = ?`;
      const params: (string | number)[] = [eventId];

      if (action) {
        query += ' AND al.action = ?';
        params.push(action as string);
      }

      if (entity_type) {
        query += ' AND al.entity_type = ?';
        params.push(entity_type as string);
      }

      query += ' ORDER BY al.created_at DESC';

      if (limit) {
        query += ' LIMIT ?';
        params.push(parseInt(limit as string, 10));
      }

      if (offset) {
        query += ' OFFSET ?';
        params.push(parseInt(offset as string, 10));
      }

      const rows = await db.all<AuditLogRow>(query, params);
      const body: AuditLogResponse = rows.map(toAuditLogEntry);
      typedJson(res, body);
    } catch (error) {
      console.error('Error fetching audit log:', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  },
);

// GET /audit/entity/:type/:id - Get logs for specific entity
router.get(
  '/entity/:type/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { type, id } = req.params;
      const { limit } = req.query;
      const db = await getDatabase();

      let query = `${AUDIT_LOG_SELECT}
        WHERE al.entity_type = ? AND al.entity_id = ?
        ORDER BY al.created_at DESC`;
      const params: (string | number)[] = [type, id];

      if (limit) {
        query += ' LIMIT ?';
        params.push(parseInt(limit as string, 10));
      }

      const rows = await db.all<AuditLogRow>(query, params);
      const body: AuditLogResponse = rows.map(toAuditLogEntry);
      typedJson(res, body);
    } catch (error) {
      console.error('Error fetching entity audit log:', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  },
);

// Helper function to create audit entries (used internally by other routes)
export async function createAuditEntry(
  db: Database,
  params: {
    event_id?: number | null;
    user_id?: number | null;
    action: string;
    entity_type: string;
    entity_id?: number | null;
    old_value?: string | null;
    new_value?: string | null;
    ip_address?: string | null;
  },
): Promise<number | undefined> {
  // Validate user_id exists to avoid FK constraint failure (e.g. stale session, test fixtures)
  let auditUserId: number | null = params.user_id ?? null;
  if (auditUserId != null) {
    const exists = await db.get('SELECT 1 FROM users WHERE id = ?', [
      auditUserId,
    ]);
    if (!exists) auditUserId = null;
  }

  const result = await db.run(
    `INSERT INTO audit_log (event_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.event_id ?? null,
      auditUserId,
      params.action,
      params.entity_type,
      params.entity_id ?? null,
      params.old_value ?? null,
      params.new_value ?? null,
      params.ip_address ?? null,
    ],
  );
  return result.lastID;
}

// POST /audit - Create audit entry (internal use, but exposed for flexibility)
// Note: This endpoint requires auth but is primarily for internal/admin use
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { event_id, action, entity_type, entity_id, old_value, new_value } =
      req.body;

    if (!action || !entity_type) {
      return res
        .status(400)
        .json({ error: 'action and entity_type are required' });
    }

    const db = await getDatabase();

    const id = await createAuditEntry(db, {
      event_id,
      user_id: req.user?.id,
      action,
      entity_type,
      entity_id,
      old_value: old_value ? JSON.stringify(old_value) : null,
      new_value: new_value ? JSON.stringify(new_value) : null,
      ip_address: req.ip || null,
    });

    res.status(201).json({ id, message: 'Audit entry created' });
  } catch (error) {
    console.error('Error creating audit entry:', error);
    res.status(500).json({ error: 'Failed to create audit entry' });
  }
});

export default router;
