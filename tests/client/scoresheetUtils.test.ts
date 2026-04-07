import { describe, expect, it } from 'vitest';
import {
  buildDoubleEliminationSchema,
  buildEventScopedBracketSource,
  findBracketGameBySelection,
  formatBracketGameOptionLabel,
  getScoresheetNumberInputMode,
  getBracketGameOptionValue,
  isEventScopedBracketSource,
} from '../../src/client/components/scoresheetUtils';

describe('scoresheetUtils', () => {
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

  it('uses numeric input mode for whole-number scoresheet fields', () => {
    expect(getScoresheetNumberInputMode({})).toBe('numeric');
    expect(getScoresheetNumberInputMode({ step: 1 })).toBe('numeric');
    expect(getScoresheetNumberInputMode({ step: '2' })).toBe('numeric');
  });

  it('uses decimal input mode for fractional scoresheet fields', () => {
    expect(getScoresheetNumberInputMode({ step: 0.5 })).toBe('decimal');
    expect(getScoresheetNumberInputMode({ step: '0.25' })).toBe('decimal');
    expect(getScoresheetNumberInputMode({ step: 'any' })).toBe('decimal');
  });
});
