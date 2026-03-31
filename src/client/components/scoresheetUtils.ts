/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BracketTeamDisplay {
  teamNumber: string;
  displayName: string;
}

export interface BracketGameOption {
  gameNumber: number;
  bracketGameId?: number;
  bracketId?: number;
  bracketName?: string | null;
  roundName?: string | null;
  bracketSide?: string | null;
  queuePosition?: number | null;
  team1: BracketTeamDisplay | null;
  team2: BracketTeamDisplay | null;
  hasWinner?: boolean;
}

export interface DbBracketSource {
  type: 'db';
  scope?: 'event';
  eventId?: number | null;
  bracketId?: number | null;
}

export function buildEventScopedBracketSource(
  eventId: number | null,
): DbBracketSource {
  return {
    type: 'db',
    scope: 'event',
    eventId,
  };
}

export function getBracketSourceEventId(
  bracketSource: unknown,
  fallbackEventId?: number | null,
): number | null {
  if (!bracketSource || typeof bracketSource !== 'object') {
    return fallbackEventId ?? null;
  }

  const source = bracketSource as DbBracketSource;
  if (source.type !== 'db') {
    return fallbackEventId ?? null;
  }

  if (source.scope === 'event') {
    return source.eventId ?? fallbackEventId ?? null;
  }

  return fallbackEventId ?? null;
}

export function isEventScopedBracketSource(
  bracketSource: unknown,
  fallbackEventId?: number | null,
): boolean {
  return getBracketSourceEventId(bracketSource, fallbackEventId) != null;
}

export function adaptDoubleEliminationFields(templateFields: any[]): any[] {
  return templateFields.map((field) => {
    const newField = { ...field };

    if (newField.id) {
      newField.id = newField.id
        .replace(/side_a/g, 'team_a')
        .replace(/side_b/g, 'team_b');
    }

    if (newField.formula) {
      newField.formula = newField.formula
        .replace(/side_a/g, 'team_a')
        .replace(/side_b/g, 'team_b');
    }

    if (newField.type === 'section_header') {
      if (newField.label === 'SIDE A') newField.label = 'TEAM A';
      if (newField.label === 'SIDE B') newField.label = 'TEAM B';
    }

    return newField;
  });
}

export function buildDoubleEliminationSchema(options: {
  title: string;
  eventId: number | null;
  templateFields?: any[] | null;
}): any {
  const { title, eventId, templateFields } = options;
  const schema: any = {
    layout: 'two-column',
    mode: 'head-to-head',
    title: title || 'Double Elimination Score Sheet',
    eventId,
    scoreDestination: 'db',
    bracketSource: buildEventScopedBracketSource(eventId),
    teamsDataSource: {
      type: 'db',
      eventId,
      teamNumberField: 'team_number',
      teamNameField: 'team_name',
    },
    fields: [],
  };

  schema.fields.push({
    id: 'game_number',
    label: 'Game',
    type: 'dropdown',
    required: true,
    dataSource: {
      type: 'bracket',
    },
    cascades: {
      team_a_number: 'team1.teamNumber',
      team_a_name: 'team1.displayName',
      team_b_number: 'team2.teamNumber',
      team_b_name: 'team2.displayName',
    },
  });

  schema.fields.push({
    id: 'team_a_number',
    label: 'Team A Number',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_a_name',
    label: 'Team A Name',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_b_number',
    label: 'Team B Number',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_b_name',
    label: 'Team B Name',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'winner',
    label: 'Winner',
    type: 'winner-select',
    required: true,
    options: [
      { value: 'team_a', label: 'Team A Wins' },
      { value: 'team_b', label: 'Team B Wins' },
    ],
  });

  if (templateFields && templateFields.length > 0) {
    schema.fields.push(...adaptDoubleEliminationFields(templateFields));
    return schema;
  }

  schema.fields.push({
    id: 'section_header_team_a',
    label: 'TEAM A',
    type: 'section_header',
    column: 'left',
  });

  schema.fields.push({
    id: 'team_a_score',
    label: 'Team A Score',
    type: 'number',
    column: 'left',
    required: false,
    min: 0,
    step: 1,
  });

  schema.fields.push({
    id: 'team_a_total',
    label: 'TEAM A TOTAL',
    type: 'calculated',
    column: 'left',
    isTotal: true,
    formula: 'team_a_score',
  });

  schema.fields.push({
    id: 'section_header_team_b',
    label: 'TEAM B',
    type: 'section_header',
    column: 'right',
  });

  schema.fields.push({
    id: 'team_b_score',
    label: 'Team B Score',
    type: 'number',
    column: 'right',
    required: false,
    min: 0,
    step: 1,
  });

  schema.fields.push({
    id: 'team_b_total',
    label: 'TEAM B TOTAL',
    type: 'calculated',
    column: 'right',
    isTotal: true,
    formula: 'team_b_score',
  });

  return schema;
}

export function formatBracketGameOptionLabel(game: BracketGameOption): string {
  const team1Display = game.team1?.displayName || 'TBD';
  const team2Display = game.team2?.displayName || 'TBD';
  return `${team1Display} vs ${team2Display}`;
}

export function getBracketGameOptionValue(
  game: BracketGameOption,
  eventScoped: boolean,
): string {
  if (eventScoped) {
    return game.bracketGameId != null ? String(game.bracketGameId) : '';
  }

  return String(game.gameNumber);
}

export function findBracketGameBySelection(
  games: BracketGameOption[],
  selectedValue: string,
  eventScoped: boolean,
): BracketGameOption | undefined {
  const numericValue = Number(selectedValue);
  if (!selectedValue || Number.isNaN(numericValue)) {
    return undefined;
  }

  if (eventScoped) {
    return games.find((game) => game.bracketGameId === numericValue);
  }

  return games.find((game) => game.gameNumber === numericValue);
}
