import express, { Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase, Database } from '../database/connection';

const router = express.Router();
router.use(requireAdmin);

// GET /audit/event/:eventId - Get audit log for event
router.get('/event/:eventId', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /audit/entity/:type/:id - Get logs for specific entity
router.get('/entity/:type/:id', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    console.error('Error fetching entity audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

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

export default router;
