export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly body: unknown;

  constructor(
    message: string,
    options: { status: number; retryAfterMs?: number; body?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.body = options.body;
  }
}

export class ApiParseError extends Error {
  constructor(message = 'Invalid JSON response') {
    super(message);
    this.name = 'ApiParseError';
  }
}

const FALLBACK_ERROR_MESSAGE = 'Request failed';
export const VERSIONED_GET_CACHE = 'no-cache' as const;

export function parseRetryAfterHeader(
  value: string | null,
): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function headersWithDefaults(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
}

function parseJsonValue(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parsedJsonBody(
  text: string,
  contentType: string,
): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const looksHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML');
  if (looksHtml) return undefined;

  const looksJson =
    contentType.includes('application/json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');
  if (!looksJson) return undefined;

  return parseJsonValue(trimmed);
}

function messageFromErrorBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim();
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }
  return undefined;
}

async function createApiError(response: Response): Promise<ApiError> {
  const retryAfterMs = parseRetryAfterHeader(
    response.headers.get('Retry-After'),
  );
  const contentType = response.headers.get('Content-Type') ?? '';
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    text = '';
  }
  const body = parsedJsonBody(text, contentType);
  const message =
    messageFromErrorBody(body) ??
    `${FALLBACK_ERROR_MESSAGE} (${response.status})`;
  return new ApiError(message, {
    status: response.status,
    retryAfterMs,
    body,
  });
}

async function fetchWithDefaults(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      ...options,
      // Query staleTime is the freshness policy; do not let HTTP caches hide writes.
      cache: options.cache ?? 'no-store',
      credentials: options.credentials ?? 'include',
      headers: headersWithDefaults(options.headers),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw error;
  }
}

async function parseJsonBody<T>(response: Response): Promise<T> {
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiParseError('Invalid JSON response');
  }

  if (text.trim() === '') {
    throw new ApiParseError('Empty JSON response');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiParseError('Invalid JSON response');
  }
}

export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchWithDefaults(url, options);
  if (!response.ok) {
    throw await createApiError(response);
  }
  return parseJsonBody<T>(response);
}

export async function requestVoid(
  url: string,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetchWithDefaults(url, options);
  if (!response.ok) {
    throw await createApiError(response);
  }
  try {
    await response.arrayBuffer();
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
}
