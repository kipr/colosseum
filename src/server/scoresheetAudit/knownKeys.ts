/**
 * Inventories of keys observed in checked-in scoresheet templates.
 * Source: ZOD_SCORESHEETS.md §1. These lists are the audit allow-list;
 * they are not the canonical Zod schema (that is a later PR).
 */

export const KNOWN_FIELD_KEYS = [
  'autoAppendBlankRow',
  'autoPopulated',
  'cascades',
  'checkboxLabel',
  'column',
  'dataSource',
  'defaultValue',
  'derived',
  'description',
  'fields',
  'formula',
  'id',
  'isGrandTotal',
  'isMultiplier',
  'isTotal',
  'label',
  'max',
  'min',
  'minRows',
  'options',
  'placeholder',
  'pruneBlankRows',
  'required',
  'rowLabel',
  'step',
  'suffix',
  'type',
] as const;

/** Legacy field keys that have dedicated detectors, so they are not "unknown". */
export const LEGACY_FIELD_KEYS = ['startValue', 'name'] as const;

export const KNOWN_SCHEMA_KEYS = [
  'title',
  'layout',
  'fields',
  'mode',
  'bracketSource',
  'teamsDataSource',
  'description',
  'eventId',
  'scoreDestination',
  'scoreKind',
  'gameAreasImage',
] as const;

/** Schema keys to watch for; they are not unknown, but they fire dedicated codes. */
export const SCHEMA_WATCH_KEYS = [
  'queueConfig',
  'useQueueForSeeding',
  'schemaVersion',
] as const;

export const HEADER_FIELD_TYPES = new Set(['section_header', 'group_header']);

export const KNOWN_FIELD_KEY_SET = new Set<string>([
  ...KNOWN_FIELD_KEYS,
  ...LEGACY_FIELD_KEYS,
]);

export const KNOWN_SCHEMA_KEY_SET = new Set<string>([
  ...KNOWN_SCHEMA_KEYS,
  ...SCHEMA_WATCH_KEYS,
]);
