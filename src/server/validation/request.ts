import type { Response } from 'express';
import type { ZodType } from 'zod';

export interface ValidationIssueResponse {
  path: string;
  code: string;
  message: string;
}

export function parseRequest<T>(
  schema: ZodType<T>,
  value: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  res.status(400).json({
    error: 'Invalid request payload',
    issues: result.error.issues.map(
      (issue): ValidationIssueResponse => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
        message: issue.message,
      }),
    ),
  });
  return null;
}
