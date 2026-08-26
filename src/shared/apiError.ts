export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_STATE';

export type ApiErrorLocation = 'params' | 'query' | 'body';

export interface ApiErrorIssue {
  location: ApiErrorLocation;
  path: Array<string | number>;
  code: string;
  message: string;
}

export interface NestedApiError {
  code: ApiErrorCode | string;
  message: string;
  issues?: ApiErrorIssue[];
}

export interface ApiErrorResponse {
  error: NestedApiError | string;
}

export function getApiError(payload: unknown): NestedApiError | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as ApiErrorResponse).error;
  if (typeof error === 'string') {
    return { code: 'INVALID_STATE', message: error };
  }
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error;
  }
  return null;
}

export function getApiErrorMessage(
  payload: unknown,
  fallback = 'Request failed',
): string {
  const error = getApiError(payload);
  if (error?.message?.trim()) return error.message;
  return fallback;
}
