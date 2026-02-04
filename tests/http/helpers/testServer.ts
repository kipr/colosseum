/**
 * HTTP test server utilities.
 * Provides helpers to create Express apps with optional auth shims,
 * start/stop ephemeral servers, and make JSON requests via Node fetch.
 */
import express, { Express, Request, Response, NextFunction } from 'express';
import type { Server } from 'http';

export interface TestUser {
  id: number;
  is_admin: boolean;
  access_token?: string;
  name?: string;
  email?: string;
}

export interface TestAppOptions {
  /** If provided, requests will be authenticated as this user */
  user?: TestUser;
}

/**
 * Create an Express app configured for testing.
 * Includes JSON body parsing and optional auth shim.
 */
export function createTestApp(options: TestAppOptions = {}): Express {
  const app = express();

  // JSON body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Auth shim middleware
  if (options.user) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).isAuthenticated = () => true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = options.user;
      next();
    });
  } else {
    // No auth - isAuthenticated returns false
    app.use((req: Request, _res: Response, next: NextFunction) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).isAuthenticated = () => false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = undefined;
      next();
    });
  }

  return app;
}

export interface TestServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Start the Express app on an ephemeral port.
 * Returns the base URL and a close function.
 */
export function startServer(app: Express): Promise<TestServerHandle> {
  return new Promise((resolve, reject) => {
    let server: Server;
    try {
      server = app.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;
        resolve({
          baseUrl,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => {
                if (err) rej(err);
                else res();
              });
            }),
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

export interface JsonResponse<T = unknown> {
  status: number;
  json: T;
  headers: Headers;
}

/**
 * Make a JSON HTTP request to a URL.
 * Returns status code and parsed JSON body.
 */
export async function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<JsonResponse<T>> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  // Handle empty responses (204 No Content)
  let json: T;
  const contentType = response.headers.get('content-type');
  if (
    response.status === 204 ||
    !contentType ||
    !contentType.includes('application/json')
  ) {
    json = {} as T;
  } else {
    json = (await response.json()) as T;
  }

  return {
    status: response.status,
    json,
    headers: response.headers,
  };
}

/**
 * Convenience methods for common HTTP verbs.
 */
export const http = {
  get: <T = unknown>(url: string) => jsonRequest<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) =>
    jsonRequest<T>('POST', url, body),
  patch: <T = unknown>(url: string, body?: unknown) =>
    jsonRequest<T>('PATCH', url, body),
  put: <T = unknown>(url: string, body?: unknown) =>
    jsonRequest<T>('PUT', url, body),
  delete: <T = unknown>(url: string) => jsonRequest<T>('DELETE', url),
};
