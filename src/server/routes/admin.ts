import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listAdminUsers } from '../usecases/listAdminUsers';

const router = express.Router();

// Get all admin users with activity status
router.get('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listAdminUsers({ db });
    res.json(result.users);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

export default router;
