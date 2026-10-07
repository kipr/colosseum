import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase, Database } from '../database/connection';
import { toAuditJson } from '../utils/auditJson';

const router = express.Router();

// GET /audit/event/:eventId - Get audit log for event
router.get(
  '/event/:eventId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { eventId } = req.params;
    const { limit, offset, action, entity_type } = req.query;
    const db = await getDatabase();

    let query = `
      SELECT al.*, u.name as user_name, u.email as user_email
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.event_id = ?
    `;
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

    const logs = await db.all(query, params);
    res.json(logs);
  },
);

// GET /audit/entity/:type/:id - Get logs for specific entity
router.get(
  '/entity/:type/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { type, id } = req.params;
    const { limit } = req.query;
    const db = await getDatabase();

    let query = `
      SELECT al.*, u.name as user_name, u.email as user_email
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = ? AND al.entity_id = ?
      ORDER BY al.created_at DESC
    `;
    const params: (string | number)[] = [type, id];

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit as string, 10));
    }

    const logs = await db.all(query, params);
    res.json(logs);
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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

/**
 * Audit an operation performed by the request's user: fills user_id and
 * ip_address from the request and serializes old/new values with toAuditJson.
 */
export function auditRequest(
  db: Database,
  req: Request,
  entry: {
    event_id?: number | null;
    action: string;
    entity_type: string;
    entity_id?: number | null;
    old_value?: unknown;
    new_value?: unknown;
  },
): Promise<number | undefined> {
  return createAuditEntry(db, {
    ...entry,
    user_id: (req as AuthRequest).user?.id ?? null,
    old_value: toAuditJson(entry.old_value),
    new_value: toAuditJson(entry.new_value),
    ip_address: req.ip ?? null,
  });
}

// POST /audit - Create audit entry (internal use, but exposed for flexibility)
// Note: This endpoint requires auth but is primarily for internal/admin use
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { event_id, action, entity_type, entity_id, old_value, new_value } =
    req.body;

  if (!action || !entity_type) {
    return res
      .status(400)
      .json({ error: 'action and entity_type are required' });
  }

  const db = await getDatabase();

  const id = await auditRequest(db, req, {
    event_id,
    action,
    entity_type,
    entity_id,
    old_value: old_value || null,
    new_value: new_value || null,
  });

  res.status(201).json({ id, message: 'Audit entry created' });
});

export default router;
