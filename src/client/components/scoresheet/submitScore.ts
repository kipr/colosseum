import type { ScoresheetSchema } from '../../../shared/domain/scoresheetSchema';
import { formatBracketDisplay } from './scoresheetData';

export interface ScoreFieldEntry {
  label: string;
  value: unknown;
  type: string;
}

export interface BuildPayloadInput {
  templateId: number;
  schema: ScoresheetSchema;
  formData: Record<string, unknown>;
  calculatedValues: Record<string, number>;
  teamsData: Array<Record<string, unknown>>;
  dynamicData: Record<string, Array<Record<string, unknown>>>;
  isHeadToHead: boolean;
}

export interface ScorePayload {
  body: Record<string, unknown>;
  isDbBackedSeeding: boolean;
  isDbBackedBracket: boolean;
}

/**
 * Build the JSON payload sent to `POST /api/scores/submit`. Returns the body
 * plus flags describing whether DB persistence will be triggered server-side
 * (used by the caller to decide post-submit behaviour like cache writes).
 */
export function buildScorePayload({
  templateId,
  schema,
  formData,
  calculatedValues,
  teamsData,
  dynamicData,
  isHeadToHead,
}: BuildPayloadInput): ScorePayload {
  const scoreData: Record<string, ScoreFieldEntry> = {};

  schema.fields.forEach((field) => {
    if (field.type === 'section_header' || field.type === 'group_header') {
      return;
    }

    let value: unknown;
    if (field.type === 'calculated') {
      value = calculatedValues[field.id] || 0;
    } else {
      const rawValue = formData[field.id];
      if (field.type === 'number') {
        value = rawValue !== undefined && rawValue !== '' ? rawValue : 0;
      } else {
        value =
          rawValue !== undefined
            ? rawValue
            : field.type === 'checkbox'
              ? false
              : '';
      }
    }

    scoreData[field.id] = {
      label: field.label,
      value,
      type: field.type,
    };
  });

  let participantName = '';
  let matchId: string | number = '';

  if (isHeadToHead) {
    const winnerTeam =
      formData.winner === 'team_a'
        ? {
            number: formData.team_a_number,
            name: formData.team_a_name,
            bracketDisplay: formData.team_a_bracket_display,
          }
        : {
            number: formData.team_b_number,
            name: formData.team_b_name,
            bracketDisplay: formData.team_b_bracket_display,
          };

    participantName = `${winnerTeam.number} - ${winnerTeam.name}`;
    matchId = formData.game_number as string | number;

    scoreData.winner_team_number = {
      label: 'Winner Team Number',
      value: winnerTeam.number,
      type: 'text',
    };
    scoreData.winner_team_name = {
      label: 'Winner Team Name',
      value: winnerTeam.name,
      type: 'text',
    };
    scoreData.winner_display = {
      label: 'Winner Display',
      value:
        (winnerTeam.bracketDisplay as string) ||
        formatBracketDisplay(
          String(winnerTeam.number),
          String(winnerTeam.name),
        ),
      type: 'text',
    };
  } else {
    participantName = String(scoreData['team_name']?.value || '');
    matchId = (scoreData['round']?.value as string | number) || '';
  }

  const eventId = schema.eventId ?? null;
  const scoreDestination = schema.scoreDestination;
  const isDbBackedSeeding = !!(
    scoreDestination === 'db' &&
    eventId &&
    !isHeadToHead
  );
  const isDbBackedBracket = !!(
    isHeadToHead &&
    scoreDestination === 'db' &&
    eventId &&
    schema.bracketSource?.type === 'db' &&
    formData.bracket_game_id != null
  );

  if (isDbBackedSeeding && scoreData.team_number?.value) {
    const fromQueue = formData.team_id;
    const fromDropdown = (dynamicData.team_number || []).find(
      (t) =>
        String(t.team_number || t['Team Number']) ===
        String(scoreData.team_number.value),
    );
    const teamId = fromQueue ?? (fromDropdown?.team_id as number | undefined);
    if (teamId != null) {
      scoreData.team_id = {
        label: 'Team ID',
        value: teamId,
        type: 'number',
      };
    }
  }

  if (isDbBackedBracket) {
    const winnerTeamNum =
      formData.winner === 'team_a'
        ? formData.team_a_number
        : formData.team_b_number;
    const winnerTeam = teamsData.find((t) => {
      const n = String(t.team_number ?? t['Team Number'] ?? '');
      return n === String(winnerTeamNum);
    });
    if (winnerTeam?.id != null) {
      scoreData.winner_team_id = {
        label: 'Winner Team ID',
        value: winnerTeam.id,
        type: 'number',
      };
    }
    const team1Score =
      calculatedValues.team_a_total ?? formData.team_a_score ?? 0;
    const team2Score =
      calculatedValues.team_b_total ?? formData.team_b_score ?? 0;
    scoreData.team1_score = {
      label: 'Team 1 Score',
      value: team1Score,
      type: 'number',
    };
    scoreData.team2_score = {
      label: 'Team 2 Score',
      value: team2Score,
      type: 'number',
    };
  }

  const body = {
    templateId,
    participantName,
    matchId,
    scoreData,
    isHeadToHead,
    bracketSource: isHeadToHead ? schema.bracketSource : null,
    eventId: isDbBackedSeeding || isDbBackedBracket ? eventId : undefined,
    scoreType: isDbBackedSeeding
      ? 'seeding'
      : isDbBackedBracket
        ? 'bracket'
        : undefined,
    game_queue_id: formData.game_queue_id ?? undefined,
    bracket_game_id: isDbBackedBracket ? formData.bracket_game_id : undefined,
  };

  return { body, isDbBackedSeeding, isDbBackedBracket };
}

export type SubmitOutcome =
  | { kind: 'success' }
  | { kind: 'authError'; message: string }
  | { kind: 'error'; message: string };

/** POST the payload and translate the response into a `SubmitOutcome` discriminator. */
export async function submitScore(
  payload: ScorePayload,
): Promise<SubmitOutcome> {
  try {
    const response = await fetch('/api/scores/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body),
    });

    if (response.status === 401 || response.status === 403) {
      const data = await response.json().catch(() => ({}));
      const message =
        (data as { error?: string }).error ||
        'Session expired. Redirecting to scoresheet selection...';
      return { kind: 'authError', message };
    }
    if (!response.ok) {
      return { kind: 'error', message: 'Failed to submit score' };
    }
    return { kind: 'success' };
  } catch (error) {
    console.error('Error submitting score:', error);
    return {
      kind: 'error',
      message: 'Failed to submit score. Please try again.',
    };
  }
}
