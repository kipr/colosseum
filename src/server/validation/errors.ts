import type { Response } from 'express';
import type { Issue } from './schema';
import type {
  ApiErrorCode,
  ApiErrorIssue,
  ApiErrorLocation,
} from '../../shared/apiError';

export type { ApiErrorCode, ApiErrorIssue, ApiErrorLocation };

export function mapSchemaIssues(
  error: { issues: Issue[] },
  location: ApiErrorLocation,
): ApiErrorIssue[] {
  return error.issues.map((issue) => ({
    location,
    path: [...issue.path],
    code: issue.code,
    message: issue.message,
  }));
}

export function sendClientError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  issues?: ApiErrorIssue[],
): void {
  res.status(status).json({
    error: {
      code,
      message,
      ...(issues && issues.length > 0 ? { issues } : {}),
    },
  });
}

export function sendValidationError(
  res: Response,
  issues: ApiErrorIssue[],
  message = 'The request contains invalid values.',
): void {
  sendClientError(res, 400, 'VALIDATION_FAILED', message, issues);
}

export function sendInvalidState(res: Response, message: string): void {
  sendClientError(res, 400, 'INVALID_STATE', message);
}

export function sendNotFound(res: Response, message: string): void {
  sendClientError(res, 404, 'NOT_FOUND', message);
}

export function sendForbidden(res: Response, message: string): void {
  sendClientError(res, 403, 'FORBIDDEN', message);
}

export function sendConflict(res: Response, message: string): void {
  sendClientError(res, 409, 'CONFLICT', message);
}
