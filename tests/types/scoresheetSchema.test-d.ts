import type {
  BracketScoreSubmissionRequest,
  DoubleSeedingScoresheetSchema,
  FieldTemplate,
  HeadToHeadScoresheetSchema,
  NumberScoreEntry,
  RepeatableGroupChildField,
  RepeatableGroupDerivationConfig,
  RepeatableGroupDerivedResult,
  RepeatableGroupRowFor,
  ScoreData,
  ScoreType,
  ScoreSubmissionRecord,
  ScoreSubmissionRequest,
  ScoresheetField,
  ScoresheetSchema,
  ScoresheetTemplate,
  StoredFieldTemplate,
  StoredScoreSubmissionRecord,
  StoredScoresheetTemplate,
} from '../../src/shared/scoresheetSchema';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type SchemaKindMatchesScoreType = Assert<
  Equal<ScoresheetSchema['kind'], ScoreType>
>;

const fields = [
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    placeholder: 'Team name',
    autoPopulated: true,
    defaultValue: 'Example',
  },
  {
    id: 'points',
    label: 'Points',
    type: 'number',
    min: 0,
    max: 100,
    step: 1,
    isMultiplier: true,
    suffix: '× 2',
    defaultValue: 4,
  },
  {
    id: 'division',
    label: 'Division',
    type: 'dropdown',
    options: [{ label: 'Open', value: 'open' }],
  },
  {
    id: 'team_number',
    label: 'Team',
    type: 'dropdown',
    dataSource: {
      type: 'db',
      eventId: 42,
      labelField: 'team_number',
      valueField: 'team_number',
    },
    cascades: { targetField: 'team_name', sourceField: 'team_name' },
  },
  {
    id: 'game_number',
    label: 'Game',
    type: 'dropdown',
    dataSource: { type: 'bracket' },
    cascades: {
      team_a_number: 'team1.teamNumber',
      team_b_number: 'team2.teamNumber',
    },
  },
  {
    id: 'choice',
    label: 'Choice',
    type: 'buttons',
    options: [{ label: 'Yes', value: true }],
  },
  {
    id: 'confirmed',
    label: 'Confirmed',
    type: 'checkbox',
    checkboxLabel: 'Legacy display label',
  },
  {
    id: 'total',
    label: 'Total',
    type: 'calculated',
    formula: 'points * 2',
    isTotal: true,
    isGrandTotal: true,
  },
  { id: 'section', label: 'Section', type: 'section_header' },
  { id: 'group', label: 'Group', type: 'group_header' },
  {
    id: 'winner',
    label: 'Winner',
    type: 'winner-select',
    options: [{ label: 'Team A', value: 'team_a' }],
  },
  {
    id: 'items',
    label: 'Items',
    type: 'repeatableGroup',
    fields: [
      { id: 'count', label: 'Count', type: 'number', defaultValue: 0 },
      {
        id: 'kind',
        label: 'Kind',
        type: 'dropdown',
        options: [{ label: 'A', value: 'a' }],
      },
    ],
    minRows: 1,
    maxRows: 10,
    autoAppendBlankRow: true,
    pruneBlankRows: true,
    derived: {
      type: 'exampleItemScoring',
      pointsPerItem: 5,
      outputs: { subtotal: 'items_subtotal' },
    },
    defaultValue: [{ count: 2, kind: 'a' }],
  },
] satisfies ScoresheetField[];

const derivation = {
  type: 'exampleItemScoring',
  pointsPerItem: 5,
  includeBonus: true,
  outputs: { subtotal: 'items_subtotal' },
} satisfies RepeatableGroupDerivationConfig;

const typedRowFields = [
  { id: 'count', label: 'Count', type: 'number' },
  { id: 'notes', label: 'Notes', type: 'text' },
] as const satisfies readonly RepeatableGroupChildField[];

const typedRow = {
  count: 2,
  notes: 'ok',
} satisfies RepeatableGroupRowFor<typeof typedRowFields>;

const invalidTypedRow = {
  // @ts-expect-error A declared number child cannot contain a numeric string.
  count: '2',
} satisfies RepeatableGroupRowFor<typeof typedRowFields>;

const derivedResult = {
  subtotal: 10,
  rows: [{ subtotal: 10, qualified: true, category: null }],
} satisfies RepeatableGroupDerivedResult;

const seedingSchema = {
  kind: 'seeding',
  schemaVersion: 1,
  title: 'Seeding',
  layout: 'two-column',
  eventId: 42,
  scoreDestination: 'db',
  teamsDataSource: { type: 'db', eventId: 42 },
  gameAreasImage: 'data:image/png;base64,example',
  fields,
} satisfies ScoresheetSchema;

const bracketSchema = {
  kind: 'bracket',
  title: 'Bracket',
  layout: 'two-column',
  eventId: 42,
  scoreDestination: 'db',
  bracketSource: { type: 'db', scope: 'event', eventId: 42 },
  teamsDataSource: { type: 'db', eventId: 42 },
  fields,
} satisfies HeadToHeadScoresheetSchema;

const doubleSeedingSchema = {
  kind: 'double_seeding',
  title: 'Double seeding',
  eventId: 42,
  scoreDestination: 'db',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields,
} satisfies DoubleSeedingScoresheetSchema;

const scoreData = {
  points: { label: 'Points', type: 'number', value: 12 },
  total: { label: 'Total', type: 'calculated', value: 24 },
  division: { label: 'Division', type: 'dropdown', value: 'open' },
  confirmed: { label: 'Confirmed', type: 'checkbox', value: true },
  items: {
    label: 'Items',
    type: 'repeatableGroup',
    value: [{ count: 2, kind: 'a' }],
    derived: derivedResult,
  },
  _isHeadToHead: { type: 'boolean', value: false },
  _bracketSource: { type: 'object', value: null },
} satisfies ScoreData;

const template = {
  id: 1,
  name: 'Seeding',
  description: null,
  created_at: '2026-08-27T00:00:00Z',
  schema: seedingSchema,
} satisfies ScoresheetTemplate;

const storedTemplate = {
  ...template,
  schema: JSON.stringify(seedingSchema),
} satisfies StoredScoresheetTemplate;

const fieldTemplate = {
  id: 2,
  name: 'Fields',
  description: null,
  created_by: 1,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
  fields,
} satisfies FieldTemplate;

const storedFieldTemplate = {
  ...fieldTemplate,
  fields_json: JSON.stringify(fields),
} satisfies StoredFieldTemplate;

const bracketRequest = {
  templateId: 1,
  participantName: 'Team A vs Team B',
  matchId: '12',
  scoreData,
  eventId: 42,
  scoreType: 'bracket',
  isHeadToHead: true,
  bracketSource: { type: 'db', scope: 'event', eventId: 42 },
  bracket_game_id: 12,
  resultType: 'standard',
} satisfies BracketScoreSubmissionRequest;

const requests = [
  {
    templateId: 1,
    participantName: 'Team 123',
    matchId: '1',
    scoreData,
    eventId: 42,
    scoreType: 'seeding',
    isHeadToHead: false,
    bracketSource: null,
  },
  bracketRequest,
  {
    templateId: 1,
    participantName: 'Team A vs Team B',
    matchId: 'Round 1',
    scoreData,
    eventId: 42,
    scoreType: 'double_seeding',
    isHeadToHead: false,
    bracketSource: null,
    double_seeding_match_id: 9,
  },
] satisfies ScoreSubmissionRequest[];

const submission = {
  id: 3,
  user_id: null,
  template_id: 1,
  participant_name: 'Team 123',
  match_id: '1',
  score_data: scoreData,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  event_id: 42,
  score_type: 'seeding',
  game_queue_id: null,
  bracket_game_id: null,
  seeding_score_id: null,
  double_seeding_match_id: null,
  result_type: 'standard',
  disqualified_team_id: null,
  result_note: null,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
} satisfies ScoreSubmissionRecord;

const storedSubmission = {
  ...submission,
  score_data: JSON.stringify(scoreData),
} satisfies StoredScoreSubmissionRecord;

declare function acceptField(field: ScoresheetField): void;
declare function acceptSchema(schema: ScoresheetSchema): void;
declare function acceptNumberEntry(entry: NumberScoreEntry): void;
declare function acceptDerivation(
  config: RepeatableGroupDerivationConfig,
): void;

function inspectSchema(schema: ScoresheetSchema): void {
  // @ts-expect-error Bracket-specific data requires discriminator narrowing.
  void schema.bracketSource;

  switch (schema.kind) {
    case 'seeding':
      break;
    case 'bracket':
      void schema.bracketSource;
      break;
    case 'double_seeding':
      break;
    default: {
      const exhaustive: never = schema;
      void exhaustive;
    }
  }
}

acceptField({
  id: 'team',
  label: 'Team',
  type: 'dropdown',
  // @ts-expect-error Spreadsheet-backed sources are not supported.
  dataSource: { sheetName: 'Teams', range: 'A:B' },
});
// @ts-expect-error Numeric score entries must contain actual numbers.
acceptNumberEntry({ label: 'Points', type: 'number', value: '12' });
acceptSchema({
  kind: 'seeding',
  // @ts-expect-error Arbitrary layouts are not part of the schema vocabulary.
  layout: 'grid',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  // @ts-expect-error Unsupported discriminator values are rejected.
  kind: 'versus',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
// @ts-expect-error Every schema must declare its archetype.
acceptSchema({ teamsDataSource: { type: 'db', eventId: 42 }, fields: [] });
// @ts-expect-error Every scoring archetype must declare its event-team source.
acceptSchema({ kind: 'seeding', fields: [] });
acceptSchema({
  // @ts-expect-error The head-to-head spelling is not canonical.
  kind: 'head-to-head',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  // @ts-expect-error The double-seeding spelling is not canonical.
  kind: 'double-seeding',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
// @ts-expect-error Bracket schemas require a bracket source.
acceptSchema({
  kind: 'bracket',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  kind: 'seeding',
  // @ts-expect-error Legacy mode is not part of a canonical schema.
  mode: 'head-to-head',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  kind: 'double_seeding',
  // @ts-expect-error Legacy scoreKind is not part of a canonical schema.
  scoreKind: 'double_seeding',
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  kind: 'seeding',
  // @ts-expect-error Seeding schemas cannot declare bracket-specific data.
  bracketSource: { type: 'db' },
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptSchema({
  kind: 'double_seeding',
  // @ts-expect-error Double-seeding schemas cannot declare bracket-specific data.
  bracketSource: { type: 'db' },
  teamsDataSource: { type: 'db', eventId: 42 },
  fields: [],
});
acceptField({
  id: 'outer',
  label: 'Outer',
  type: 'repeatableGroup',
  fields: [
    // @ts-expect-error Repeatable groups cannot contain nested repeatable groups.
    { id: 'inner', label: 'Inner', type: 'repeatableGroup', fields: [] },
  ],
});
// @ts-expect-error Derived outputs map names to score-field IDs, not numbers.
acceptDerivation({ type: 'example', outputs: { subtotal: 12 } });
// @ts-expect-error Canonical fields require an ID and label.
acceptField({ type: 'number' });
// @ts-expect-error startValue is intentionally unsupported.
acceptField({ id: 'legacy', label: 'Legacy', type: 'text', startValue: 'old' });

void derivation;
void (null as unknown as SchemaKindMatchesScoreType);
void inspectSchema;
void typedRow;
void invalidTypedRow;
void bracketSchema;
void doubleSeedingSchema;
void storedTemplate;
void storedFieldTemplate;
void requests;
void storedSubmission;
