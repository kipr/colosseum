import { describe, expect, it } from 'vitest';
import {
  buildDoubleEliminationSchema,
  buildEventScopedBracketSource,
  buildRepeatableGroupDerivedScoreEntries,
  buildRepeatableGroupScoreEntry,
  calculateRepeatableGroupDerivedValues,
  createBlankRepeatableGroupRow,
  findBracketGameBySelection,
  formatBracketGameOptionLabel,
  getBracketGameOptionValue,
  getRepeatableGroupRowKeys,
  isEventScopedBracketSource,
  isRepeatableGroupRowBlank,
  normalizeRepeatableGroupRows,
  pruneRepeatableGroupRows,
  shouldAutoAppendRepeatableGroupRow,
} from '../../src/client/components/scoresheetUtils';

describe('scoresheetUtils', () => {
  const repeatableGroupField = {
    id: 'cube_stacks',
    label: 'Cube Stacks',
    type: 'repeatableGroup',
    minRows: 2,
    fields: [
      { id: 'has_pallet', label: 'Pallet', type: 'checkbox' },
      { id: 'small_red', label: 'Small Red', type: 'number' },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
  };

  it('builds new DE schemas with an event-scoped bracket source', () => {
    const schema = buildDoubleEliminationSchema({
      title: 'Shared DE Sheet',
      eventId: 42,
      templateFields: null,
    });

    expect(schema.mode).toBe('head-to-head');
    expect(schema.eventId).toBe(42);
    expect(schema.bracketSource).toEqual(buildEventScopedBracketSource(42));
    expect(schema.teamsDataSource.eventId).toBe(42);
  });

  it('adapts template fields from side A/B to team A/B', () => {
    const schema = buildDoubleEliminationSchema({
      title: 'Adapted DE Sheet',
      eventId: 7,
      templateFields: [
        {
          id: 'side_a_score',
          label: 'Side A Score',
          type: 'number',
        },
        {
          id: 'side_b_total',
          label: 'Side B Total',
          type: 'calculated',
          formula: 'side_b_score + side_a_score',
        },
      ],
    });

    expect(
      schema.fields.some(
        (field: { id: string }) => field.id === 'team_a_score',
      ),
    ).toBe(true);
    expect(
      schema.fields.some(
        (field: { id: string }) => field.id === 'team_b_total',
      ),
    ).toBe(true);
    expect(
      schema.fields.find((field: { id: string }) => field.id === 'team_b_total')
        ?.formula,
    ).toBe('team_b_score + team_a_score');
  });

  it('formats judge game labels without bracket or game context', () => {
    const label = formatBracketGameOptionLabel({
      gameNumber: 12,
      bracketGameId: 99,
      bracketId: 5,
      bracketName: 'Silver',
      team1: { teamNumber: '410', displayName: '410 Alpha' },
      team2: { teamNumber: '125', displayName: '125 Beta' },
    });

    expect(label).toBe('410 Alpha vs 125 Beta');
  });

  it('uses bracket_game_id for event-scoped selection lookup', () => {
    const games = [
      {
        gameNumber: 1,
        bracketGameId: 100,
        bracketId: 10,
        bracketName: 'Alpha',
        team1: { teamNumber: '1', displayName: '1 One' },
        team2: { teamNumber: '2', displayName: '2 Two' },
      },
      {
        gameNumber: 1,
        bracketGameId: 200,
        bracketId: 20,
        bracketName: 'Beta',
        team1: { teamNumber: '3', displayName: '3 Three' },
        team2: { teamNumber: '4', displayName: '4 Four' },
      },
    ];

    expect(
      isEventScopedBracketSource({ type: 'db', scope: 'event', eventId: 9 }),
    ).toBe(true);
    expect(getBracketGameOptionValue(games[1], true)).toBe('200');
    expect(findBracketGameBySelection(games, '200', true)?.bracketName).toBe(
      'Beta',
    );
  });

  it('keeps legacy bracket-scoped selection keyed by game number', () => {
    const games = [
      {
        gameNumber: 4,
        bracketGameId: 400,
        bracketId: 33,
        team1: { teamNumber: '8', displayName: '8 Eight' },
        team2: { teamNumber: '9', displayName: '9 Nine' },
      },
    ];

    expect(isEventScopedBracketSource({ type: 'db', bracketId: 33 })).toBe(
      false,
    );
    expect(getBracketGameOptionValue(games[0], false)).toBe('4');
    expect(findBracketGameBySelection(games, '4', false)?.bracketGameId).toBe(
      400,
    );
  });

  it('creates the configured minimum number of blank repeatable group rows', () => {
    expect(createBlankRepeatableGroupRow(repeatableGroupField)).toEqual({
      has_pallet: false,
      small_red: '',
      notes: '',
    });

    expect(
      normalizeRepeatableGroupRows(undefined, repeatableGroupField),
    ).toEqual([
      { has_pallet: false, small_red: '', notes: '' },
      { has_pallet: false, small_red: '', notes: '' },
    ]);
  });

  it('detects blank repeatable group rows across number checkbox and text fields', () => {
    expect(
      isRepeatableGroupRowBlank(
        { has_pallet: false, small_red: 0, notes: '' },
        repeatableGroupField,
      ),
    ).toBe(true);
    expect(
      isRepeatableGroupRowBlank(
        { has_pallet: true, small_red: 0, notes: '' },
        repeatableGroupField,
      ),
    ).toBe(false);
    expect(
      isRepeatableGroupRowBlank(
        { has_pallet: false, small_red: 1, notes: '' },
        repeatableGroupField,
      ),
    ).toBe(false);
    expect(
      isRepeatableGroupRowBlank(
        { has_pallet: false, small_red: 0, notes: 'checked' },
        repeatableGroupField,
      ),
    ).toBe(false);
  });

  it('auto-appends only when the final repeatable group row has a meaningful value', () => {
    expect(
      shouldAutoAppendRepeatableGroupRow(
        [{ has_pallet: false, small_red: '', notes: '' }],
        repeatableGroupField,
      ),
    ).toBe(false);
    expect(
      shouldAutoAppendRepeatableGroupRow(
        [{ has_pallet: false, small_red: '2', notes: '' }],
        repeatableGroupField,
      ),
    ).toBe(true);
    expect(
      shouldAutoAppendRepeatableGroupRow(
        [
          { has_pallet: false, small_red: '2', notes: '' },
          { has_pallet: false, small_red: '', notes: '' },
        ],
        repeatableGroupField,
      ),
    ).toBe(false);
  });

  it('prunes fully blank repeatable group rows while keeping partially entered rows', () => {
    const rows = [
      { has_pallet: false, small_red: '', notes: '' },
      { has_pallet: true, small_red: '', notes: '' },
      { has_pallet: false, small_red: 0, notes: 'needs review' },
      { has_pallet: false, small_red: '', notes: '', derived_count: 4 },
    ];

    expect(pruneRepeatableGroupRows(rows, repeatableGroupField)).toEqual([
      { has_pallet: true, small_red: '', notes: '' },
      { has_pallet: false, small_red: 0, notes: 'needs review' },
      { has_pallet: false, small_red: '', notes: '', derived_count: 4 },
    ]);
  });

  it('does not prune repeatable group row data that is present outside configured child fields', () => {
    const malformedField = {
      ...repeatableGroupField,
      fields: [],
    };

    expect(
      pruneRepeatableGroupRows(
        [
          { small_red: '', has_pallet: false },
          { small_red: '2', has_pallet: false },
        ],
        malformedField,
      ),
    ).toEqual([{ small_red: '2', has_pallet: false }]);
  });

  it('preserves entered nested row values during repeatable group normalization', () => {
    expect(
      normalizeRepeatableGroupRows(
        [{ has_pallet: true, small_red: '3', notes: 'stacked' }],
        repeatableGroupField,
      ),
    ).toEqual([
      { has_pallet: true, small_red: '3', notes: 'stacked' },
      { has_pallet: false, small_red: '', notes: '' },
    ]);
  });

  it('preserves submitted repeatable group rows on save when edit rows are unchanged', () => {
    const existingEntry = {
      label: 'Cube Stacks',
      value: [{ has_pallet: true, small_red: '3', notes: 'stacked' }],
      type: 'repeatableGroup',
      derived: {
        rows: [{ status: 'sorted', subtotal: 10 }],
      },
    };

    const entry = buildRepeatableGroupScoreEntry(
      repeatableGroupField,
      existingEntry,
      [
        { has_pallet: true, small_red: '3', notes: 'stacked' },
        { has_pallet: false, small_red: '', notes: '' },
      ],
    );

    expect(entry.value).toEqual(existingEntry.value);
    expect(entry.derived).toEqual(existingEntry.derived);
  });

  it('prunes blank repeatable group rows on save when configured', () => {
    const entry = buildRepeatableGroupScoreEntry(
      {
        ...repeatableGroupField,
        pruneBlankRows: true,
      },
      {
        label: 'Cube Stacks',
        value: [],
        type: 'repeatableGroup',
      },
      [
        { has_pallet: false, small_red: '', notes: '' },
        { has_pallet: true, small_red: '', notes: '' },
        { has_pallet: false, small_red: '', notes: '' },
      ],
    );

    expect(entry.value).toEqual([
      { has_pallet: true, small_red: '', notes: '' },
    ]);
  });

  it('removes repeatable group derived metadata when rows change', () => {
    const entry = buildRepeatableGroupScoreEntry(
      repeatableGroupField,
      {
        label: 'Cube Stacks',
        value: [{ has_pallet: true, small_red: '3', notes: 'stacked' }],
        type: 'repeatableGroup',
        derived: {
          rows: [{ status: 'sorted', equivalent: 2, subtotal: 10 }],
        },
      },
      [{ has_pallet: true, small_red: '4', notes: 'stacked' }],
    );

    expect(entry.value).toEqual([
      { has_pallet: true, small_red: '4', notes: 'stacked' },
      { has_pallet: false, small_red: '', notes: '' },
    ]);
    expect(entry.derived).toBeUndefined();
  });

  it('collects repeatable group row keys for fallback rendering safely', () => {
    expect(
      getRepeatableGroupRowKeys([
        { has_pallet: true, small_red: '1' },
        null,
        'bad row',
        { notes: 'late entry', small_red: '2' },
      ]),
    ).toEqual(['has_pallet', 'small_red', 'notes']);
  });

  it('produces configured derived outputs from repeatable group rows', () => {
    const field = {
      id: 'side_a_ild_cube_stacks',
      label: 'Internal Loading Dock Stacks',
      type: 'repeatableGroup',
      pruneBlankRows: true,
      fields: [
        { id: 'has_pallet', label: 'Pallet', type: 'checkbox' },
        { id: 'small_red', label: 'Small Red', type: 'number' },
        { id: 'small_green', label: 'Small Green', type: 'number' },
        { id: 'small_yellow', label: 'Small Yellow', type: 'number' },
        { id: 'large_red', label: 'Large Red', type: 'number' },
        { id: 'large_green', label: 'Large Green', type: 'number' },
        { id: 'large_brown', label: 'Large Brown', type: 'number' },
      ],
      derived: {
        type: 'botballCubeStacks',
        sortedValue: 30,
        unsortedValue: 10,
        outputs: {
          sortedEquivalent: 'side_a_ild_sorted_cubes',
          unsortedEquivalent: 'side_a_ild_unsorted_cubes',
          subtotal: 'side_a_ild_subtotal',
        },
      },
    };
    const fields = [
      field,
      {
        id: 'side_a_ild_subtotal',
        label: 'ILD Subtotal',
        type: 'calculated',
      },
    ];

    const { derivedByFieldId, outputs } = calculateRepeatableGroupDerivedValues(
      fields,
      {
        side_a_ild_cube_stacks: [
          { has_pallet: true, small_red: '2', large_brown: '1' },
          { has_pallet: false, small_red: '', large_brown: '' },
          { has_pallet: false, large_green: '1' },
        ],
      },
    );

    expect(outputs).toEqual({
      side_a_ild_sorted_cubes: 10,
      side_a_ild_unsorted_cubes: 4,
      side_a_ild_subtotal: 340,
    });
    expect(derivedByFieldId.side_a_ild_cube_stacks.rows).toEqual([
      { sorted: true, sortedColor: 'red', equivalent: 10, subtotal: 300 },
      { sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 },
    ]);
    expect(
      buildRepeatableGroupDerivedScoreEntries(fields, derivedByFieldId),
    ).toEqual({
      side_a_ild_sorted_cubes: {
        label: 'Sorted Cubes',
        type: 'number',
        value: 10,
      },
      side_a_ild_unsorted_cubes: {
        label: 'Unsorted Cubes',
        type: 'number',
        value: 4,
      },
      side_a_ild_subtotal: {
        label: 'ILD Subtotal',
        type: 'calculated',
        value: 340,
      },
    });
  });

  it('stores repeatable group derived rows when supplied on score entry build', () => {
    const derived = {
      sortedEquivalent: 2,
      unsortedEquivalent: 0,
      subtotal: 60,
      rows: [{ sorted: true, sortedColor: 'red', equivalent: 2, subtotal: 60 }],
    };

    const entry = buildRepeatableGroupScoreEntry(
      repeatableGroupField,
      undefined,
      [{ has_pallet: true, small_red: '2', notes: '' }],
      derived,
    );

    expect(entry.value).toEqual([
      { has_pallet: true, small_red: '2', notes: '' },
      { has_pallet: false, small_red: '', notes: '' },
    ]);
    expect(entry.derived).toEqual(derived);
  });

  it('does not publish derived outputs when no derived config is present', () => {
    const { derivedByFieldId, outputs } = calculateRepeatableGroupDerivedValues(
      [repeatableGroupField],
      {
        cube_stacks: [{ has_pallet: true, small_red: '2', notes: '' }],
      },
    );

    expect(derivedByFieldId).toEqual({});
    expect(outputs).toEqual({});
  });
});
