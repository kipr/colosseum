import { Request, Response, NextFunction } from 'express';

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  expose?: boolean;
}

/**
 * Final Express error handler. Express 5 forwards rejected async route
 * handlers here, so routes only need their own catch when they map an error
 * to a specific 4xx response.
 *
 * Client errors that are marked safe to expose (e.g. body-parser's malformed
 * JSON or oversized payload) keep their status and message. Everything else
 * becomes a generic 500 so database or internal error text never reaches the
 * client.
 */
export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = err.status ?? err.statusCode;
  if (
    err.expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    res.status(status).json({ error: err.message });
    return;
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error' });
}
