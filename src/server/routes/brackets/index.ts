import express from 'express';
import { requireAuth } from '../../middleware/auth';
import { composeRouters } from '../composeRouters';
import { registerEventRoutes } from './event';
import { registerTemplateRoutes } from './templates';
import { registerRankingRoutes } from './rankings';
import { registerCrudRoutes } from './crud';
import { registerEntryRoutes } from './entries';
import { registerGameRoutes } from './games';

const publicRouter = express.Router();
const authRouter = express.Router();
authRouter.use(requireAuth);

// Path-safe order: /event/... and /templates before /:id.
registerEventRoutes(publicRouter, authRouter);
registerTemplateRoutes(publicRouter, authRouter);
registerRankingRoutes(publicRouter, authRouter);
registerCrudRoutes(publicRouter, authRouter);
registerEntryRoutes(authRouter);
registerGameRoutes(publicRouter, authRouter);

export default composeRouters(publicRouter, authRouter);
