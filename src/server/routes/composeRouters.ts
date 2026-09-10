import { Router } from 'express';

/**
 * Mount routers in order. Register public (or otherwise unguarded) routers
 * first. A later router may call `router.use(requireAuth)` / `requireAdmin`
 * only when it is last, or when every remaining path should use that guard —
 * blanket middleware on an earlier router runs even for unmatched paths and
 * will block fallthrough.
 */
export function composeRouters(...routers: Router[]): Router {
  const router = Router();
  for (const r of routers) {
    router.use(r);
  }
  return router;
}
