/**
 * HTTP response DTOs shared by the Express server and the React client.
 *
 * Pair to `src/shared/domain/` (which holds entity-level enums, DTOs, label
 * maps, and validators). This subtree holds the *response shapes* for
 * specific endpoints — i.e. what the server actually puts on the wire and
 * what the client can rely on receiving.
 *
 * See `./README.md` for migration rules and the outstanding backlog.
 */

export * from './admin';
export * from './auth';
export * from './events';
export * from './awards';
export * from './scores';
export * from './overall';
export * from './audit';
export * from './queue';
export * from './seeding';
export * from './documentationScores';
export * from './chat';
export * from './scoresheetTemplates';
