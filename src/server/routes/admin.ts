import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Get all admin users with activity status
router.get('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();

    // Get all admin users with last activity
    const users = await db.all(`
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

    // Add activity status to each user
    const now = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usersWithStatus = users.map((user: any) => {
      // Handle both Date objects (PostgreSQL) and strings (SQLite)
      let lastActivityTime: number | null = null;
      if (user.last_activity) {
        if (user.last_activity instanceof Date) {
          lastActivityTime = user.last_activity.getTime();
        } else {
          lastActivityTime = new Date(user.last_activity).getTime();
        }
      }

      // Consider "active" if activity within last 5 minutes
      const isActive = lastActivityTime
        ? now - lastActivityTime < 5 * 60 * 1000
        : false;
      // Consider "recently active" if within last hour
      const isRecentlyActive = lastActivityTime
        ? now - lastActivityTime < 60 * 60 * 1000
        : false;

      return {
        ...user,
        last_activity: lastActivityTime
          ? new Date(lastActivityTime).toISOString()
          : null,
        isActive,
        isRecentlyActive,
        tokenValid: user.token_expires_at ? user.token_expires_at > now : false,
      };
    });

    res.json(usersWithStatus);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

export default router;
