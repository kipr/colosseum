import { Request, Response, NextFunction } from 'express';
import 'express-session';

export interface JudgeAuth {
  templateId: number;
  eventIds: number[];
  /**
   * Server-minted opaque key identifying this judge's conversation thread.
   * Never accepted from judge-supplied input; this is what scopes a judge to
   * their own chat thread and prevents judge-to-judge access.
   */
  conversationKey: string;
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

/** True when the request has an unexpired judge session scoped to `eventId`. */
export function isJudgeSessionValidForEvent(
  req: Request,
  eventId: number,
): boolean {
  const judgeAuth = req.session?.judgeAuth;
  if (!judgeAuth) return false;
  if (Date.now() > judgeAuth.expiresAt) return false;
  return judgeAuth.eventIds.includes(eventId);
}

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

/**
 * Authorization guard for event-scoped chat routes. Unlike requireJudgeSession,
 * it reads `eventId` from `req.params` (chat routes are nested under
 * `/events/:eventId`). Authenticated users bypass (per-route admin checks
 * apply); access-code judges must have a valid, unexpired session whose
 * eventIds include the requested event.
 */
export function requireEventChatAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Authenticated admins (and other authenticated users) bypass; routes that
  // are admin-only enforce is_admin themselves.
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

  const eventId = req.params.eventId;
  if (eventId == null || !judgeAuth.eventIds.includes(Number(eventId))) {
    return res
      .status(403)
      .json({ error: 'Judge session does not match the requested event.' });
  }

  return next();
}
