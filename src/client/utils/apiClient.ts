/**
 * Thin wrapper around fetch() that defaults to credentialed requests and
 * unwraps JSON responses. Intended to remove the heavy duplication of
 *   fetch(url, { credentials: 'include' }).then(r => r.json())
 * patterns scattered across admin tabs.
 */

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

function makeApiError(
  status: number,
  body: unknown,
  fallback: string,
): ApiError {
  const message =
    (typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : '') || fallback;
  const err = new Error(message) as ApiError;
  err.status = status;
  err.body = body;
  return err;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** When provided, will be JSON.stringified and Content-Type set automatically. */
  json?: unknown;
}

/** Low-level helper. Returns the raw `Response` for callers that need it. */
export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
  };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers = {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    };
  } else if (headers) {
    init.headers = headers;
  }
  return fetch(url, init);
}

/**
 * GET helper. Throws an `ApiError` on non-2xx responses, otherwise returns the
 * parsed JSON body cast to `T`.
 */
export async function apiJson<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await apiFetch(url, { method: 'GET', ...options });
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw makeApiError(
      response.status,
      body,
      `Request failed: ${response.status}`,
    );
  }
  return body as T;
}

/**
 * Send helper for POST/PUT/PATCH/DELETE. Body is JSON-encoded when provided.
 * Throws an `ApiError` on non-2xx responses.
 */
export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  options: ApiFetchOptions = {},
): Promise<T> {
  const init: ApiFetchOptions = { method, ...options };
  if (body !== undefined) {
    init.json = body;
  }
  const response = await apiFetch(url, init);
  const responseBody = await parseJsonSafe(response);
  if (!response.ok) {
    throw makeApiError(
      response.status,
      responseBody,
      `Request failed: ${response.status}`,
    );
  }
  return responseBody as T;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof Error &&
    typeof (value as ApiError).status === 'number' &&
    'body' in value
  );
}
