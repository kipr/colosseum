/**
 * Thin wrapper around fetch for the Colosseum API.
 *
 * - Always sends cookies (`credentials: 'include'`).
 * - Plain-object bodies are JSON-encoded with the matching Content-Type;
 *   FormData, Blob, URLSearchParams and string bodies pass through untouched.
 * - Non-2xx responses throw ApiError. The message comes from the JSON
 *   `error` field when present, never from a JSON parse failure, so an HTML
 *   502/504 from a proxy still yields a readable message.
 */

export class ApiError extends Error {
  readonly status: number;
  /** Parsed error body, or null when it was empty or not JSON. */
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Error message used when the response carries no `error` field. */
  fallbackError?: string;
}

function isPassthroughBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  );
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Like apiFetch, but also returns the Response for callers that need its
 * headers (for example a version ETag).
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; response: Response }> {
  const { body, fallbackError, headers, ...init } = options;
  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined;

  if (body !== undefined) {
    if (isPassthroughBody(body)) {
      finalBody = body;
    } else {
      finalBody = JSON.stringify(body);
      if (!finalHeaders.has('Content-Type')) {
        finalHeaders.set('Content-Type', 'application/json');
      }
    }
  }

  const response = await fetch(path, {
    ...init,
    headers: finalHeaders,
    body: finalBody,
    credentials: 'include',
  });

  const text = await response.text();

  if (!response.ok) {
    const data = parseJson(text);
    const serverError =
      data && typeof data === 'object' && 'error' in data
        ? (data as { error?: unknown }).error
        : undefined;
    // Server 5xx bodies are deliberately generic, so a caller-supplied
    // fallback describes the failure better.
    const preferFallback = response.status >= 500 && fallbackError;
    const message =
      !preferFallback && typeof serverError === 'string' && serverError
        ? serverError
        : (fallbackError ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, data);
  }

  const data = (text ? JSON.parse(text) : undefined) as T;
  return { data, response };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  return (await apiRequest<T>(path, options)).data;
}
