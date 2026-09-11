import type { Response } from 'express';
import type { ServiceResult } from '../../services/serviceResult';

export function sendServiceResult<T>(
  res: Response,
  result: ServiceResult<T, object>,
): void {
  if (!result.ok) {
    const { ok: _ok, status, ...body } = result;
    void _ok;
    res.status(status).json(body);
    return;
  }
  res.status(result.status).json(result.data);
}
