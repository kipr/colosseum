import { auditSchema } from './audit';
import { awardsSchema } from './awards';
import { bracketsSchema } from './brackets';
import { documentationSchema } from './documentation';
import { doubleSeedingSchema } from './doubleSeeding';
import { eventsSchema } from './events';
import { judgeChatSchema } from './judgeChat';
import { queueSchema } from './queue';
import { scoringSchema } from './scoring';
import { scoresheetsSchema } from './scoresheets';
import { seedingSchema } from './seeding';
import { sessionsSchema } from './sessions';
import { usersSchema } from './users';
import type { SchemaModule } from './types';

export const schemaModules: readonly SchemaModule[] = [
  usersSchema,
  scoresheetsSchema,
  eventsSchema,
  seedingSchema,
  documentationSchema,
  scoringSchema,
  bracketsSchema,
  doubleSeedingSchema,
  queueSchema,
  sessionsSchema,
  auditSchema,
  awardsSchema,
  judgeChatSchema,
];

export { runSchema } from './runner';
export type { SchemaDialect, SchemaModule } from './types';
