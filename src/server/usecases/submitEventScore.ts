import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';
import {
  acceptEventScore,
  updateBracketQueueItem,
  updateSeedingQueueItem,
} from '../services/scoreAccept';

export interface SubmitEventScoreParams {
  db: Database;
  body: Record<string, unknown>;
  ipAddress: string | null;
}

export type SubmitEventScoreResult =
  | {
      ok: true;
      submission: Record<string, unknown>;
      autoAccepted: boolean;
    }
  | {
      ok: false;
      status: 400;
      error: string;
    };

interface ScoreFieldValue {
  value?: unknown;
}

function asField(value: unknown): ScoreFieldValue | undefined {
  if (value && typeof value === 'object') {
    return value as ScoreFieldValue;
  }
  return undefined;
}

/**
 * Submit an event-scoped score. Encapsulates validation, payload enrichment,
 * insert, audit, queue side effects, and auto-accept evaluation. Caller (route
 * handler) is responsible for translating the discriminated-union result into
 * an HTTP response and for handling unexpected errors.
 */
export async function submitEventScore(
  params: SubmitEventScoreParams,
): Promise<SubmitEventScoreResult> {
  const { db, body, ipAddress } = params;

  const templateId = body.templateId as number | undefined;
  const participantName = (body.participantName as string | undefined) ?? null;
  const matchId = (body.matchId as string | undefined) ?? null;
  const scoreData = body.scoreData as
    | Record<string, ScoreFieldValue>
    | undefined;
  const isHeadToHead = body.isHeadToHead as boolean | undefined;
  const bracketSource = body.bracketSource as unknown;
  const eventId = body.eventId as number | undefined;
  const scoreType = body.scoreType as 'seeding' | 'bracket' | undefined;
  const game_queue_id = body.game_queue_id as number | null | undefined;
  const bracket_game_id = body.bracket_game_id as number | null | undefined;

  if (!templateId || !scoreData) {
    return {
      ok: false,
      status: 400,
      error: 'Template ID and score data are required',
    };
  }

  const template = await db.get(
    'SELECT id, name, created_by, spreadsheet_config_id FROM scoresheet_templates WHERE id = ?',
    [templateId],
  );

  if (!template) {
    return { ok: false, status: 400, error: 'Template not found' };
  }

  // DB-backed (event-scoped) submission: resolve team_id if needed (seeding)
  const attemptingDbBackedSeeding = !!(eventId && scoreType === 'seeding');
  let resolvedTeamId = asField(scoreData.team_id)?.value as number | undefined;
  const teamNumberValue = asField(scoreData.team_number)?.value;
  if (attemptingDbBackedSeeding && !resolvedTeamId && teamNumberValue != null) {
    const team = await db.get<{ id: number }>(
      'SELECT id FROM teams WHERE event_id = ? AND team_number = ?',
      [eventId, teamNumberValue],
    );
    resolvedTeamId = team?.id;
  }
  const isDbBackedSeeding = attemptingDbBackedSeeding && !!resolvedTeamId;

  // DB-backed bracket submission: validate bracket_game_id belongs to event
  // (game query JOINs brackets/events, so event existence is validated implicitly)
  const attemptingDbBackedBracket = !!(
    eventId &&
    scoreType === 'bracket' &&
    bracket_game_id != null
  );
  let isDbBackedBracket = false;
  if (attemptingDbBackedBracket) {
    const game = await db.get(
      `SELECT bg.id FROM bracket_games bg
       JOIN brackets b ON bg.bracket_id = b.id
       WHERE bg.id = ? AND b.event_id = ?`,
      [bracket_game_id, eventId],
    );
    if (!game) {
      return {
        ok: false,
        status: 400,
        error:
          'Bracket game not found or does not belong to this event. Invalid event.',
      };
    }
    isDbBackedBracket = true;
  }

  if (eventId && scoreType === 'bracket' && bracket_game_id == null) {
    return {
      ok: false,
      status: 400,
      error: 'bracket_game_id is required for DB-backed bracket submission',
    };
  }

  const isDbBacked = isDbBackedSeeding || isDbBackedBracket;

  const spreadsheetConfigId: number | null = null;

  // Single event validation for seeding (bracket already validated via game query)
  if (attemptingDbBackedSeeding) {
    const event = await db.get('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return { ok: false, status: 400, error: 'Invalid event' };
    }
    if (!resolvedTeamId) {
      return {
        ok: false,
        status: 400,
        error: 'Team not found for event. Check team number.',
      };
    }
    // Enforce team belongs to event (prevents cross-event submission via team_id)
    const team = await db.get(
      'SELECT id FROM teams WHERE id = ? AND event_id = ?',
      [resolvedTeamId, eventId],
    );
    if (!team) {
      return {
        ok: false,
        status: 400,
        error: 'Team not found or does not belong to this event.',
      };
    }
  }

  if (!isDbBacked) {
    return {
      ok: false,
      status: 400,
      error:
        'Event-scoped submission is required. Provide eventId and scoreType (seeding or bracket) with bracket_game_id for bracket scores.',
    };
  }

  // Add metadata to score data for head-to-head
  const enrichedScoreData: Record<string, unknown> = {
    ...scoreData,
    _isHeadToHead: { value: isHeadToHead || false, type: 'boolean' },
    _bracketSource: { value: bracketSource ?? null, type: 'object' },
  };
  if (isDbBacked && resolvedTeamId) {
    enrichedScoreData.team_id = {
      label: 'Team ID',
      value: resolvedTeamId,
      type: 'number',
    };
  }

  // Build insert - event-scoped uses null for spreadsheet_config_id
  const result = await db.run(
    `INSERT INTO score_submissions 
       (user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, event_id, score_type, game_queue_id, bracket_game_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      null,
      templateId,
      spreadsheetConfigId,
      participantName,
      matchId,
      JSON.stringify(enrichedScoreData),
      isDbBacked ? eventId : null,
      isDbBacked ? scoreType : null,
      game_queue_id ?? null,
      isDbBackedBracket ? bracket_game_id : null,
    ],
  );

  const submission = await db.get(
    'SELECT * FROM score_submissions WHERE id = ?',
    [result.lastID],
  );

  if (!submission) {
    // Should be unreachable — INSERT just succeeded.
    return { ok: true, submission: {}, autoAccepted: false };
  }

  // Audit event-scoped submissions only (skip legacy spreadsheet path)
  await createAuditEntry(db, {
    event_id: eventId,
    user_id: null,
    action: 'score_submitted',
    entity_type: 'score_submission',
    entity_id: submission.id,
    old_value: null,
    new_value: toAuditJson({
      id: submission.id,
      event_id: submission.event_id,
      score_type: submission.score_type,
      status: submission.status,
      score_data: submission.score_data,
    }),
    ip_address: ipAddress,
  });

  // Mark queue as scored (pending submission) as soon as the score is submitted.
  // On accept, the queue row is removed; reject/revert restores to queued.
  if (scoreType === 'seeding' && resolvedTeamId) {
    const roundNumber =
      (asField(scoreData.round)?.value as number | undefined) ??
      (asField(scoreData.round_number)?.value as number | undefined);
    if (roundNumber != null) {
      await updateSeedingQueueItem(
        db,
        eventId as number,
        resolvedTeamId,
        Number(roundNumber),
        true,
      );
    }
  } else if (scoreType === 'bracket' && bracket_game_id != null) {
    await updateBracketQueueItem(
      db,
      eventId as number,
      Number(bracket_game_id),
      true,
    );
  }

  // Auto-accept when event's score_accept_mode matches (force=false, reviewed_by=null)
  const event = await db.get<{ score_accept_mode?: string }>(
    'SELECT score_accept_mode FROM events WHERE id = ?',
    [eventId],
  );
  const mode = event?.score_accept_mode ?? 'manual';
  const shouldAutoAccept =
    mode === 'auto_accept_all' ||
    (mode === 'auto_accept_seeding' && scoreType === 'seeding');

  if (shouldAutoAccept) {
    const acceptResult = await acceptEventScore({
      db,
      submissionId: submission.id,
      force: false,
      reviewedBy: null,
      ipAddress,
    });

    if (acceptResult.ok) {
      const updated = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [submission.id],
      );
      return {
        ok: true,
        submission: updated ?? submission,
        autoAccepted: true,
      };
    }
    // Conflict or other error: leave as pending, return original submission
  }

  return { ok: true, submission, autoAccepted: false };
}
