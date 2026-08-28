/**
 * Idempotent stored-template migration from legacy `mode`/`scoreKind`
 * markers to the canonical `kind` discriminator.
 *
 * This module is migration code, not a request-path compatibility decoder.
 * After apply mode succeeds, runtime readers must require `kind`.
 */

import type { Database, Transaction } from '../connection';
import {
  isScoreType,
  isValidDbBracketSource,
  type ScoreType,
} from '../../../shared/scoresheetSchema';

const SUPPORTED_MODE = 'head-to-head';
const SUPPORTED_SCORE_KIND = 'double_seeding';

export interface TransformScoresheetKindInput {
  id: number;
  name: string;
  schemaText: string;
  linkedTemplateTypes: string[];
}

export interface TransformScoresheetKindSuccess {
  ok: true;
  schemaText: string;
  changed: boolean;
  kind: ScoreType;
  currentArchetype: string;
  targetArchetype: ScoreType;
}

export interface TransformScoresheetKindFailure {
  ok: false;
  diagnostic: string;
  currentArchetype: string;
}

export type TransformScoresheetKindResult =
  | TransformScoresheetKindSuccess
  | TransformScoresheetKindFailure;

export interface ScoresheetKindTemplateReport {
  id: number;
  name: string;
  currentArchetype: string;
  targetArchetype: ScoreType | null;
  submissionCount: number;
  changed: boolean;
  error?: string;
}

export interface ScoresheetKindMigrationReport {
  templates: ScoresheetKindTemplateReport[];
  blockers: string[];
  changedCount: number;
  unchangedCount: number;
  errorCount: number;
}

export class ScoresheetKindMigrationError extends Error {
  readonly report: ScoresheetKindMigrationReport;

  constructor(report: ScoresheetKindMigrationReport) {
    const ids = report.blockers.join('\n');
    super(
      `Scoresheet kind migration blocked by ${report.errorCount} template(s):\n${ids}`,
    );
    this.name = 'ScoresheetKindMigrationError';
    this.report = report;
  }
}

function hasOwnKey(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeLegacyValue(
  label: string,
  value: unknown,
): string {
  if (typeof value === 'string') {
    return `legacy:${label}=${value}`;
  }
  return `legacy:${label}`;
}

function describeCurrentArchetype(schema: Record<string, unknown>): string {
  if (hasOwnKey(schema, 'kind')) {
    return isScoreType(schema.kind)
      ? schema.kind
      : `unsupported:kind=${JSON.stringify(schema.kind)}`;
  }
  if (hasOwnKey(schema, 'scoreKind')) {
    return describeLegacyValue('scoreKind', schema.scoreKind);
  }
  if (hasOwnKey(schema, 'mode')) {
    return describeLegacyValue('mode', schema.mode);
  }
  if (hasOwnKey(schema, 'bracketSource')) {
    return 'legacy:bracketSource';
  }
  return 'legacy:unmarked';
}

function fail(
  input: TransformScoresheetKindInput,
  message: string,
  currentArchetype: string,
): TransformScoresheetKindFailure {
  return {
    ok: false,
    diagnostic: `template id=${input.id} name=${JSON.stringify(input.name)}: ${message}`,
    currentArchetype,
  };
}

function collectSignals(schema: Record<string, unknown>): {
  errors: string[];
  kindSignal: ScoreType | null;
  scoreKindSignal: ScoreType | null;
  modeSignal: ScoreType | null;
  bracketPresenceSignal: ScoreType | null;
} {
  const errors: string[] = [];
  let kindSignal: ScoreType | null = null;
  let scoreKindSignal: ScoreType | null = null;
  let modeSignal: ScoreType | null = null;
  let bracketPresenceSignal: ScoreType | null = null;

  const hasMode = hasOwnKey(schema, 'mode');
  const hasScoreKind = hasOwnKey(schema, 'scoreKind');

  if (hasMode && hasScoreKind) {
    errors.push(
      'schema has both legacy properties "mode" and "scoreKind"',
    );
  }

  if (hasOwnKey(schema, 'kind')) {
    if (!isScoreType(schema.kind)) {
      errors.push(`unsupported kind ${JSON.stringify(schema.kind)}`);
    } else {
      kindSignal = schema.kind;
    }
  }

  if (hasScoreKind) {
    if (schema.scoreKind !== SUPPORTED_SCORE_KIND) {
      errors.push(`unsupported scoreKind ${JSON.stringify(schema.scoreKind)}`);
    } else {
      scoreKindSignal = 'double_seeding';
    }
  }

  if (hasMode) {
    if (schema.mode !== SUPPORTED_MODE) {
      errors.push(`unsupported mode ${JSON.stringify(schema.mode)}`);
    } else {
      modeSignal = 'bracket';
    }
  }

  if (
    kindSignal == null &&
    scoreKindSignal == null &&
    modeSignal == null &&
    hasOwnKey(schema, 'bracketSource')
  ) {
    bracketPresenceSignal = 'bracket';
  }

  return {
    errors,
    kindSignal,
    scoreKindSignal,
    modeSignal,
    bracketPresenceSignal,
  };
}

function resolveKind(
  signals: ReturnType<typeof collectSignals>,
): { kind: ScoreType } | { error: string } {
  const present = [
    signals.kindSignal,
    signals.scoreKindSignal,
    signals.modeSignal,
    signals.bracketPresenceSignal,
  ].filter((value): value is ScoreType => value != null);

  if (present.length === 0) {
    return { kind: 'seeding' };
  }

  const unique = new Set(present);
  if (unique.size > 1) {
    return {
      error: `conflicting canonical and legacy signals (${[...unique].join(', ')})`,
    };
  }

  return { kind: present[0] };
}

function validateBracketSourceForKind(
  kind: ScoreType,
  schema: Record<string, unknown>,
): string | null {
  if (kind === 'bracket') {
    if (!isValidDbBracketSource(schema.bracketSource)) {
      return 'bracket schemas require a structurally valid DB bracketSource';
    }
    return null;
  }

  if (hasOwnKey(schema, 'bracketSource')) {
    return `bracketSource is not allowed on ${kind} schemas`;
  }

  return null;
}

function validateLinkage(
  kind: ScoreType,
  linkedTemplateTypes: string[],
): string | null {
  const distinct = [
    ...new Set(linkedTemplateTypes.filter((type) => type.length > 0)),
  ];
  if (distinct.length === 0) {
    return null;
  }

  const mismatched = distinct.filter((type) => type !== kind);
  if (mismatched.length === 0) {
    return null;
  }

  if (distinct.length > 1) {
    return `conflicting event-template linkage types (${distinct.join(', ')})`;
  }

  return `event-template linkage type "${distinct[0]}" does not match kind "${kind}"`;
}

/**
 * Convert one stored template schema to the canonical `kind` representation.
 * Own-property checks are used for discriminator keys.
 */
export function transformScoresheetKind(
  input: TransformScoresheetKindInput,
): TransformScoresheetKindResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.schemaText);
  } catch {
    return fail(input, 'malformed JSON', 'invalid');
  }

  if (!isPlainObject(parsed)) {
    return fail(input, 'schema JSON must be an object', 'invalid');
  }

  const currentArchetype = describeCurrentArchetype(parsed);
  const signals = collectSignals(parsed);
  if (signals.errors.length > 0) {
    return fail(input, signals.errors.join('; '), currentArchetype);
  }

  const resolved = resolveKind(signals);
  if ('error' in resolved) {
    return fail(input, resolved.error, currentArchetype);
  }

  const { kind } = resolved;
  const bracketError = validateBracketSourceForKind(kind, parsed);
  if (bracketError) {
    return fail(input, bracketError, currentArchetype);
  }

  const linkageError = validateLinkage(kind, input.linkedTemplateTypes);
  if (linkageError) {
    return fail(input, linkageError, currentArchetype);
  }

  const alreadyCanonical =
    hasOwnKey(parsed, 'kind') &&
    parsed.kind === kind &&
    !hasOwnKey(parsed, 'mode') &&
    !hasOwnKey(parsed, 'scoreKind');

  if (alreadyCanonical) {
    return {
      ok: true,
      schemaText: input.schemaText,
      changed: false,
      kind,
      currentArchetype,
      targetArchetype: kind,
    };
  }

  const output: Record<string, unknown> = { ...parsed };
  delete output.mode;
  delete output.scoreKind;
  output.kind = kind;

  return {
    ok: true,
    schemaText: JSON.stringify(output),
    changed: true,
    kind,
    currentArchetype,
    targetArchetype: kind,
  };
}

interface StoredTemplateRow {
  id: number;
  name: string;
  schema: string;
}

interface StoredLinkRow {
  template_id: number;
  template_type: string;
}

interface StoredSubmissionCountRow {
  template_id: number;
  count: number | string;
}

async function loadMigrationRows(tx: Transaction): Promise<{
  templates: StoredTemplateRow[];
  linksByTemplate: Map<number, string[]>;
  submissionsByTemplate: Map<number, number>;
}> {
  const templates = await tx.all<StoredTemplateRow>(
    'SELECT id, name, schema FROM scoresheet_templates ORDER BY id',
  );
  const links = await tx.all<StoredLinkRow>(
    'SELECT template_id, template_type FROM event_scoresheet_templates',
  );
  const submissionCounts = await tx.all<StoredSubmissionCountRow>(
    'SELECT template_id, COUNT(*) AS count FROM score_submissions GROUP BY template_id',
  );

  const linksByTemplate = new Map<number, string[]>();
  for (const link of links) {
    const existing = linksByTemplate.get(link.template_id) ?? [];
    existing.push(link.template_type);
    linksByTemplate.set(link.template_id, existing);
  }

  const submissionsByTemplate = new Map<number, number>();
  for (const row of submissionCounts) {
    submissionsByTemplate.set(row.template_id, Number(row.count));
  }

  return { templates, linksByTemplate, submissionsByTemplate };
}

function buildReport(
  templates: StoredTemplateRow[],
  linksByTemplate: Map<number, string[]>,
  submissionsByTemplate: Map<number, number>,
): {
  report: ScoresheetKindMigrationReport;
  updates: Array<{ id: number; schemaText: string }>;
} {
  const reports: ScoresheetKindTemplateReport[] = [];
  const blockers: string[] = [];
  const updates: Array<{ id: number; schemaText: string }> = [];
  let changedCount = 0;
  let unchangedCount = 0;

  for (const template of templates) {
    const result = transformScoresheetKind({
      id: template.id,
      name: template.name,
      schemaText: template.schema,
      linkedTemplateTypes: linksByTemplate.get(template.id) ?? [],
    });
    const submissionCount = submissionsByTemplate.get(template.id) ?? 0;

    if (!result.ok) {
      blockers.push(result.diagnostic);
      reports.push({
        id: template.id,
        name: template.name,
        currentArchetype: result.currentArchetype,
        targetArchetype: null,
        submissionCount,
        changed: false,
        error: result.diagnostic,
      });
      continue;
    }

    if (result.changed) {
      changedCount += 1;
      updates.push({ id: template.id, schemaText: result.schemaText });
    } else {
      unchangedCount += 1;
    }

    reports.push({
      id: template.id,
      name: template.name,
      currentArchetype: result.currentArchetype,
      targetArchetype: result.targetArchetype,
      submissionCount,
      changed: result.changed,
    });
  }

  return {
    report: {
      templates: reports,
      blockers,
      changedCount,
      unchangedCount,
      errorCount: blockers.length,
    },
    updates,
  };
}

export function formatScoresheetKindCheckLine(
  row: ScoresheetKindTemplateReport,
): string {
  const name = JSON.stringify(row.name);
  const target = row.targetArchetype ?? '-';
  const action = row.error ? 'error' : row.changed ? 'migrate' : 'unchanged';
  const errorSuffix = row.error ? ` ${row.error}` : '';
  return `id=${row.id} name=${name} current=${row.currentArchetype} target=${target} submissions=${row.submissionCount} action=${action}${errorSuffix}`;
}

/**
 * Classify every stored template without writing. Used by the check command.
 */
export async function checkScoresheetKindMigration(
  db: Database,
): Promise<ScoresheetKindMigrationReport> {
  return db.transaction(async (tx) => {
    const loaded = await loadMigrationRows(tx);
    return buildReport(
      loaded.templates,
      loaded.linksByTemplate,
      loaded.submissionsByTemplate,
    ).report;
  });
}

/**
 * Transform every stored template in one transaction. Makes no writes if any
 * row is invalid. Idempotent after a successful first run.
 */
export async function applyScoresheetKindMigration(
  db: Database,
): Promise<ScoresheetKindMigrationReport> {
  return db.transaction(async (tx) => {
    const loaded = await loadMigrationRows(tx);
    const { report, updates } = buildReport(
      loaded.templates,
      loaded.linksByTemplate,
      loaded.submissionsByTemplate,
    );

    if (report.errorCount > 0) {
      throw new ScoresheetKindMigrationError(report);
    }

    for (const update of updates) {
      await tx.run(
        `UPDATE scoresheet_templates
         SET schema = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [update.schemaText, update.id],
      );
    }

    return report;
  });
}

/**
 * Apply the kind migration during database initialization. Repeated startup
 * after a successful first run produces zero writes.
 */
export async function migrateScoresheetKindOnStartup(
  db: Database,
): Promise<void> {
  const report = await applyScoresheetKindMigration(db);
  if (report.templates.length === 0) {
    return;
  }

  console.log(
    `Scoresheet kind migration: updated ${report.changedCount} template(s), ${report.unchangedCount} already canonical.`,
  );
}
