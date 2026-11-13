import express, { Response } from 'express';
import { getDatabase } from '../database/connection';
import { isUniqueConstraintError } from '../database/constraintErrors';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth';
import { auditRequest } from './audit';

interface Season {
  id: number;
  name: string;
  sort_order: number;
}

const router = express.Router();

router.get('/', requireAuth, async (_req: AuthRequest, res: Response) => {
  const db = await getDatabase();
  const seasons = await db.all<Season>(
    'SELECT id, name, sort_order FROM seasons ORDER BY sort_order DESC, id DESC',
  );
  res.json(seasons);
});

router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      error: 'Request body must be an object containing a season name',
    });
  }

  const { name, sort_order = 0 } = req.body;
  if (typeof name !== 'string') {
    return res.status(400).json({ error: 'Season name must be a string' });
  }
  if (
    name.includes('\0') ||
    Buffer.from(name, 'utf8').toString('utf8') !== name
  ) {
    return res.status(400).json({
      error:
        'Season name must contain valid Unicode text without NUL characters',
    });
  }
  if (
    typeof sort_order !== 'number' ||
    !Number.isInteger(sort_order) ||
    sort_order < -2147483648 ||
    sort_order > 2147483647
  ) {
    return res.status(400).json({
      error: 'sort_order must be an integer between -2147483648 and 2147483647',
    });
  }

  const db = await getDatabase();
  // PostgreSQL character counts and POSIX whitespace differ from JS length/trim.
  const validation = await db.get<{ valid: boolean }>(
    `SELECT char_length(name) BETWEEN 1 AND 100
       AND name !~ '^[[:space:]]|[[:space:]]$' AS valid
     FROM (SELECT ?::text AS name) input`,
    [name],
  );
  if (!validation?.valid) {
    return res.status(400).json({
      error:
        'Season name must contain 1 to 100 characters and have no leading or trailing whitespace',
    });
  }

  let seasonId: number | undefined;
  try {
    const result = await db.run(
      'INSERT INTO seasons (name, sort_order) VALUES (?, ?) RETURNING id',
      [name, sort_order],
    );
    seasonId = result.lastID;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        error: 'A season with that name already exists',
      });
    }
    throw error;
  }

  const season = await db.get<Season>(
    'SELECT id, name, sort_order FROM seasons WHERE id = ?',
    [seasonId],
  );
  if (!season) {
    throw new Error('Created season not found');
  }
  await auditRequest(db, req, {
    action: 'season_created',
    entity_type: 'season',
    entity_id: season.id,
    new_value: season,
  });
  res.status(201).json(season);
});

export default router;
