import { Router } from 'express';

/**
 * Mount routers in order. Register public routers before a protected router
 * that calls `router.use(requireAuth)` / `requireAdmin`, so unauthenticated
 * public paths are not blocked by the guard.
 */
export function composeRouters(...routers: Router[]): Router {
  const router = Router();
  for (const r of routers) {
    router.use(r);
  }
  return router;
}
