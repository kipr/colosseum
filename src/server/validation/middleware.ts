import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Schema } from './schema';
import type { AuthRequest } from '../middleware/auth';
import type { ApiErrorIssue, ApiErrorLocation } from './errors';
import { mapSchemaIssues, sendValidationError } from './errors';

export interface RequestSchemas {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Schema<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query?: Schema<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: Schema<any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InferSchema<T> = T extends Schema<infer U> ? U : never;

export type Validated<S extends RequestSchemas> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof S as S[K] extends Schema<any> ? K : never]: InferSchema<S[K]>;
};

export type ValidatedRequest<S extends RequestSchemas> = AuthRequest & {
  validated: Validated<S>;
};

const SECTIONS = [
  'params',
  'query',
  'body',
] as const satisfies readonly ApiErrorLocation[];

function sectionInput(req: Request, location: ApiErrorLocation): unknown {
  if (location === 'params') return req.params;
  if (location === 'query') return req.query;
  return req.body ?? {};
}

/**
 * Validate selected request sections before the handler runs.
 * Parsed values are stored on `req.validated`; raw Express objects are unchanged.
 */
export function validateRequest<S extends RequestSchemas>(
  schemas: S,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated: Record<string, unknown> = {};
      const issues: ApiErrorIssue[] = [];

      for (const location of SECTIONS) {
        const schema = schemas[location];
        if (!schema) continue;
        const result = schema.safeParse(sectionInput(req, location));
        if (result.success) {
          validated[location] = result.data;
        } else {
          issues.push(...mapSchemaIssues(result.error, location));
        }
      }

      if (issues.length > 0) {
        sendValidationError(res, issues);
        return;
      }

      (req as ValidatedRequest<S>).validated = validated as Validated<S>;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Pair `validateRequest` with a handler that sees inferred `req.validated`
 * types. Express cannot type `Request` as already-validated, so the single
 * assertion lives here rather than in every route.
 */
export function validatedHandler<S extends RequestSchemas>(
  schemas: S,
  handler: (
    req: ValidatedRequest<S>,
    res: Response,
    next: NextFunction,
  ) => unknown | Promise<unknown>,
): RequestHandler[] {
  return [
    validateRequest(schemas),
    (req, res, next) => {
      void Promise.resolve(
        handler(req as ValidatedRequest<S>, res, next),
      ).catch(next);
    },
  ];
}
