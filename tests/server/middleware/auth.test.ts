/**
 * Unit tests for auth middleware (requireAuth, requireAdmin).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../../../src/server/middleware/auth';

function mockReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    isAuthenticated: () => false,
    user: undefined,
    ...overrides,
  } as unknown as AuthRequest;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

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
