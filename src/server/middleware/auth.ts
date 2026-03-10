import { Request, Response, NextFunction } from 'express';
import 'express-session';

export interface JudgeAuth {
  templateId: number;
  eventIds: number[];
  issuedAt: number;
  expiresAt: number;
}

declare module 'express-session' {
  interface SessionData {
    judgeAuth?: JudgeAuth;
  }
}

export interface AuthRequest extends Request {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: any;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.isAuthenticated() && req.user?.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

/** 12-hour judge session lifetime (one tournament day). */
export const JUDGE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Middleware that requires a valid judge session (created during access-code
 * verification) OR an authenticated admin user. Rejects with 401 when the
 * session is missing/expired and with 403 when the session doesn't match the
 * submitted templateId / eventId.
 */
export function requireJudgeSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Authenticated admins bypass the judge-session check
  if (req.isAuthenticated?.()) {
    return next();
  }

  const judgeAuth = req.session?.judgeAuth;
  if (!judgeAuth) {
    return res.status(401).json({
      error: 'Judge session required. Please verify your access code.',
    });
  }

  if (Date.now() > judgeAuth.expiresAt) {
    return res.status(401).json({
      error: 'Judge session expired. Please verify your access code again.',
    });
  }

  const { templateId, eventId } = req.body ?? {};

  if (templateId != null && judgeAuth.templateId !== Number(templateId)) {
    return res
      .status(403)
      .json({ error: 'Judge session does not match the requested template.' });
  }

  if (eventId != null && !judgeAuth.eventIds.includes(Number(eventId))) {
    return res
      .status(403)
      .json({ error: 'Judge session does not match the requested event.' });
  }

  return next();
}
