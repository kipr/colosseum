import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: any;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.isAuthenticated() && req.user?.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

