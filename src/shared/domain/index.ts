/**
 * Shared canonical domain definitions.
 *
 * Single source of truth for enum values, DTO shapes, label maps, and pure
 * validators that previously lived (sometimes redundantly) in both client and
 * server code paths. The SQL CHECK constraints in
 * `src/server/database/init.ts` are derived from the `*_STATUSES` /
 * `*_TYPES` arrays exported here, so adding or renaming a value updates the
 * schema, server validators, and client UI in one place.
 */

export * from './eventStatus';
export * from './scoreAcceptMode';
export * from './teamStatus';
export * from './queue';
export * from './bracket';
export * from './event';
export * from './team';
export * from './eventVisibility';
export * from './scoresheetSchema';
