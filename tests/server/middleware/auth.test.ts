/**
 * Unit tests for auth middleware (requireAuth, requireAdmin, judge session).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction, Request } from 'express';
import {
  requireAuth,
  requireAdmin,
  requireJudgeSession,
  requireEventChatAccess,
  isAdminUser,
  AuthRequest,
  JUDGE_SESSION_TTL_MS,
} from '../../../src/server/middleware/auth';

function mockReq(overrides: Record<string, unknown> = {}): AuthRequest {
  return {
    isAuthenticated: () => false,
    user: undefined,
    session: {},
    body: {},
    params: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function validJudgeAuth(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    templateId: 1,
    eventIds: [10],
    conversationKey: 'conv-key',
    issuedAt: now,
    expiresAt: now + JUDGE_SESSION_TTL_MS,
    ...overrides,
  };
}

describe('isAdminUser', () => {
  it('returns true for an authenticated admin', () => {
    expect(
      isAdminUser(
        mockReq({
          isAuthenticated: () => true,
          user: { is_admin: true },
        }),
      ),
    ).toBe(true);
  });

  it('returns false for an authenticated non-admin', () => {
    expect(
      isAdminUser(
        mockReq({
          isAuthenticated: () => true,
          user: { is_admin: false },
        }),
      ),
    ).toBe(false);
  });
});

describe('requireAuth', () => {
  it('calls next when authenticated', () => {
    const req = mockReq({ isAuthenticated: () => true });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', () => {
    const req = mockReq({ isAuthenticated: () => false });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Authentication required',
    });
  });
});

describe('requireAdmin', () => {
  it('calls next when authenticated and admin', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { id: 1, is_admin: true },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated but not admin', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { id: 1, is_admin: false },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('returns 403 when not authenticated', () => {
    const req = mockReq({ isAuthenticated: () => false });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when user object is missing', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: undefined,
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireJudgeSession', () => {
  it('calls next for an authenticated admin without a judge session', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { is_admin: true },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireJudgeSession(req as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for an authenticated non-admin without a judge session', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { is_admin: false },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireJudgeSession(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next for a valid judge session', () => {
    const req = mockReq({
      session: { judgeAuth: validJudgeAuth() },
      body: { templateId: 1, eventId: 10 },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireJudgeSession(req as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when templateId does not match the session', () => {
    const req = mockReq({
      session: { judgeAuth: validJudgeAuth() },
      body: { templateId: 99, eventId: 10 },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireJudgeSession(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireEventChatAccess', () => {
  it('calls next for an authenticated admin', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { is_admin: true },
      params: { eventId: '10' },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireEventChatAccess(req as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for an authenticated non-admin without a judge session', () => {
    const req = mockReq({
      isAuthenticated: () => true,
      user: { is_admin: false },
      params: { eventId: '10' },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireEventChatAccess(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next when the judge session includes the event', () => {
    const req = mockReq({
      session: { judgeAuth: validJudgeAuth() },
      params: { eventId: '10' },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireEventChatAccess(req as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the judge session does not include the event', () => {
    const req = mockReq({
      session: { judgeAuth: validJudgeAuth() },
      params: { eventId: '99' },
    });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireEventChatAccess(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
