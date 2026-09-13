/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BracketGameOption,
  type BracketTeamDisplay,
  buildRepeatableGroupDerivedScoreEntries,
  calculateRepeatableGroupDerived,
  calculateRepeatableGroupDerivedValues,
  calculateScoresheetValues,
  applyRepeatableGroupInputChange,
  findBracketGameBySelection,
  formatBracketGameOptionLabel,
  normalizeRepeatableGroupRows,
  pruneRepeatableGroupRows,
  getBracketGameOptionValue,
  getBracketSourceEventId,
  isEventScopedBracketSource,
} from './scoresheetUtils';
import { getFieldDefaultValue } from '../../shared/scoresheetSchema';
import type { BracketResultType } from '../../shared/bracketResult';
import {
  buildTeamInitialsScoreEntries,
  getMissingTeamInitialsError,
  getRequiredTeamInitialsSlots,
  inferEventScoreType,
  isTeamInitialsFieldId,
} from '../../shared/teamInitials';
import TeamInitialsFields from './TeamInitialsFields';
import ScoresheetFieldControl from './ScoresheetFieldControl';
import RepeatableGroupTable from './RepeatableGroupTable';
import '../pages/Scoresheet.css';
import { JudgeChatProvider } from '../contexts/JudgeChatContext';
import JudgeChatButton from './judgeChat/JudgeChatButton';
import JudgeChatDrawer from './judgeChat/JudgeChatDrawer';
import { compileScoresheetFormulas } from '../../shared/scoresheetFormulaProgram';
import FormulaErrors from './FormulaErrors';
import type { TemplateDetail } from '../api/templates';
import type { Team } from '../api/teams';
import { QUEUE_STATUSES } from '../api/queue';
import { judgeTeamsQueryOptions } from '../queries/teams';
import {
  judgeBracketQueryOptions,
  judgeEventGamesQueryOptions,
} from '../queries/brackets';
import { judgeQueueQueryOptions } from '../queries/queue';
import { useJudgeScoreSubmitMutation } from '../queries/scores';
import {
  isAuthorizationError,
  removeJudgeQueries,
} from '../queries/invalidation';
import QueryFeedback from './QueryFeedback';
import { clearJudgeSessionStorage } from '../utils/judgeSession';

function mapTeamSide(game: any, side: '1' | '2'): BracketTeamDisplay | null {
  const id = game[`team${side}_id`];
  const number = game[`team${side}_number`];
  const name = game[`team${side}_name`];
  if (id == null || (number == null && !name)) return null;
  return {
    teamNumber: String(number ?? name ?? ''),
    displayName: game[`team${side}_display`] || name || String(number),
  };
}

function mapGameOption(game: any, bracketId?: number): BracketGameOption {
  return {
    gameNumber: game.game_number,
    bracketId: game.bracket_id ?? bracketId,
    bracketName: game.bracket_name,
    roundName: game.round_name,
    bracketSide: game.bracket_side,
    queuePosition: game.queue_position ?? null,
    team1: mapTeamSide(game, '1'),
    team2: mapTeamSide(game, '2'),
    hasWinner: Boolean(game.winner_id) || game.status === 'completed',
    bracketGameId: game.bracket_game_id ?? game.id,
  };
}

function sortDropdownRows(rows: any[], labelField: string): any[] {
  return [...rows].sort((a, b) => {
    const aVal = String(a[labelField] ?? '');
    const bVal = String(b[labelField] ?? '');
    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return aVal.localeCompare(bVal, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function teamNumberMatches(team: Team, teamNumber: string): boolean {
  const stored = String(
    parseInt(String(team.team_number), 10) || team.team_number,
  );
  const wanted = String(parseInt(teamNumber, 10) || teamNumber);
  return stored === wanted;
}

interface ScoresheetFormProps {
  template: TemplateDetail;
  sessionGeneration: string;
}

export default function ScoresheetForm({
  template,
  sessionGeneration,
}: ScoresheetFormProps) {
  const schema: any = template.schema;
  const isHeadToHead = schema.mode === 'head-to-head';
  // Explicit marker only: head-to-head means bracket scoring with a winner.
  const isDoubleSeeding = schema.scoreKind === 'double_seeding';
  const gameAreasImage = schema.gameAreasImage;
  const isEventScopedBracket = isEventScopedBracketSource(
    schema.bracketSource,
    schema.eventId,
  );
  const bracketSourceEventId = getBracketSourceEventId(
    schema.bracketSource,
    schema.eventId,
  );

  // Use queue for DB-backed seeding: replace team+round selection with queue picker
  const useQueueForSeeding =
    schema.eventId &&
    schema.scoreDestination === 'db' &&
    !isHeadToHead &&
    !isDoubleSeeding;

  // Double-seeding matches are always selected from the queue
  const useQueueForDoubleSeeding =
    isDoubleSeeding && schema.eventId && schema.scoreDestination === 'db';

  // Helper to get initial form data with default values from schema
  const getInitialFormData = () => {
    const initial: Record<string, any> = {};
    if (!useQueueForSeeding) {
      const cachedRound = localStorage.getItem('lastRoundNumber');
      if (cachedRound) initial.round = cachedRound;
    }

    // Initialize fields with their default values if specified
    (schema.fields ?? []).forEach((field: any) => {
      if (field.type === 'repeatableGroup') {
        const startingValue = getFieldDefaultValue(field);
        initial[field.id] =
          startingValue !== undefined
            ? Array.isArray(startingValue)
              ? startingValue.map((row: any) => ({ ...row }))
              : startingValue
            : normalizeRepeatableGroupRows(undefined, field);
      } else {
        const startingValue = getFieldDefaultValue(field);
        if (startingValue !== undefined) {
          initial[field.id] = startingValue;
        }
      }
    });

    return initial;
  };

  const [formData, setFormData] =
    useState<Record<string, any>>(getInitialFormData);
  const [resultType, setResultType] = useState<BracketResultType>('standard');
  const [disqualifiedSide, setDisqualifiedSide] = useState<
    '' | 'team_a' | 'team_b'
  >('');
  const [resultNote, setResultNote] = useState('');
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {},
  );
  const compilation = useMemo(
    () => compileScoresheetFormulas(schema.fields),
    [schema.fields],
  );
  const calculation = useMemo(
    () => calculateScoresheetValues(schema.fields, formData, compilation),
    [schema.fields, formData, compilation],
  );
  const calculatedValues = calculation.values;
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [showGameAreas, setShowGameAreas] = useState(false);
  const queryClient = useQueryClient();
  const submitScore = useJudgeScoreSubmitMutation();

  const teamEventIds = useMemo(() => {
    const ids = new Set<number>();
    const teamsConfig = schema.teamsDataSource;
    if (teamsConfig?.type === 'db' && teamsConfig.eventId) {
      ids.add(Number(teamsConfig.eventId));
    }
    for (const field of schema.fields) {
      if (field.dataSource?.type === 'db' && field.dataSource.eventId) {
        ids.add(Number(field.dataSource.eventId));
      }
    }
    return [...ids];
  }, [schema]);

  const teamQueries = useQueries({
    queries: teamEventIds.map((eventId) => ({
      ...judgeTeamsQueryOptions(sessionGeneration, eventId),
      enabled: Boolean(sessionGeneration && eventId),
    })),
  });
  const teamQueryData = teamQueries.map((query) => query.data);
  const teamsByEvent = useMemo(() => {
    const map = new Map<number, Team[]>();
    teamEventIds.forEach((eventId, index) => {
      const rows = teamQueryData[index];
      if (rows) map.set(eventId, rows);
    });
    return map;
  }, [teamEventIds, teamQueryData]);
  const teamsData =
    (schema.teamsDataSource?.type === 'db' && schema.teamsDataSource.eventId
      ? teamsByEvent.get(Number(schema.teamsDataSource.eventId))
      : undefined) ??
    (schema.eventId ? teamsByEvent.get(Number(schema.eventId)) : undefined) ??
    [];

  const queueEnabled = Boolean(
    (useQueueForSeeding || useQueueForDoubleSeeding) && schema.eventId,
  );
  const queueQuery = useQuery({
    ...judgeQueueQueryOptions(sessionGeneration, Number(schema.eventId) || 0, {
      statuses: QUEUE_STATUSES,
      queueType: isDoubleSeeding ? 'double_seeding' : 'seeding',
    }),
    enabled: queueEnabled,
  });
  const queueItems = queueQuery.data ?? [];

  const eventGamesEnabled = Boolean(
    isHeadToHead &&
    isEventScopedBracket &&
    bracketSourceEventId &&
    schema.bracketSource?.type === 'db',
  );
  const eventGamesQuery = useQuery({
    ...judgeEventGamesQueryOptions(
      sessionGeneration,
      Number(bracketSourceEventId) || 0,
      { complete: false },
    ),
    enabled: eventGamesEnabled,
  });
  const singleBracketId =
    schema.bracketSource?.type === 'db' && !isEventScopedBracket
      ? schema.bracketSource.bracketId
      : null;
  const singleBracketQuery = useQuery({
    ...judgeBracketQueryOptions(
      sessionGeneration,
      Number(schema.eventId) || Number(bracketSourceEventId) || 0,
      Number(singleBracketId) || 0,
    ),
    enabled: Boolean(
      isHeadToHead && schema.bracketSource?.type === 'db' && singleBracketId,
    ),
  });

  const bracketGames = useMemo((): BracketGameOption[] => {
    if (eventGamesEnabled) {
      return (eventGamesQuery.data ?? []).map((game) => mapGameOption(game));
    }
    if (singleBracketId) {
      return (singleBracketQuery.data?.games ?? []).map((game) =>
        mapGameOption(game, singleBracketId),
      );
    }
    return [];
  }, [
    eventGamesEnabled,
    eventGamesQuery.data,
    singleBracketId,
    singleBracketQuery.data,
  ]);

  const dynamicData = useMemo(() => {
    const next: Record<string, any[]> = {};
    for (const field of schema.fields) {
      const ds = field.dataSource;
      if (
        !ds ||
        ds.type === 'bracket' ||
        (useQueueForSeeding && field.id === 'team_number')
      ) {
        continue;
      }
      if (ds.type === 'db' && ds.eventId) {
        const teams = teamsByEvent.get(Number(ds.eventId)) ?? [];
        const labelField = ds.labelField || 'team_number';
        const valueField = ds.valueField || 'team_number';
        next[field.id] = sortDropdownRows(
          teams.map((team) => ({
            [labelField]: String(team.team_number),
            [valueField]: String(team.team_number),
            team_name: team.team_name || team.display_name,
            team_id: team.id,
            'Team Number': String(team.team_number),
            'Team Name': team.team_name || team.display_name,
          })),
          labelField,
        );
      }
    }
    return next;
  }, [schema.fields, teamsByEvent, useQueueForSeeding]);

  const resourceQuery = queueQuery.isError
    ? queueQuery
    : eventGamesQuery.isError
      ? eventGamesQuery
      : singleBracketQuery.isError
        ? singleBracketQuery
        : (teamQueries.find((query) => query.isError) ?? null);

  const eventScoreType = inferEventScoreType(schema);
  const teamInitialsSlots =
    eventScoreType == null
      ? []
      : getRequiredTeamInitialsSlots({
          scoreType: eventScoreType,
          hasTeamB:
            eventScoreType === 'bracket' ||
            (eventScoreType === 'double_seeding' && formData.team_b_id != null),
        });

  // Show notification and auto-dismiss
  const showNotification = (
    message: string,
    type: 'success' | 'error' = 'success',
  ) => {
    setNotification({ message, type });

    // Scroll to top using multiple methods for better browser compatibility
    // Use a small delay to ensure the DOM has updated
    setTimeout(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0; // For Safari
    }, 100);

    // Auto-dismiss after 2 seconds
    setTimeout(() => {
      setNotification(null);
    }, 2000);
  };

  // Reset form to initial values
  const handleReset = () => {
    if (
      window.confirm(
        'Are you sure you want to reset all fields? This cannot be undone.',
      )
    ) {
      setFormData(getInitialFormData());
      setTouchedFields({});
      showNotification('Form has been reset', 'success');
    }
  };

  const lookupTeamName = (teamNumber: string): string => {
    if (!teamNumber || teamNumber === 'Bye') return 'Bye';
    const team = teamsData.find((row) => teamNumberMatches(row, teamNumber));
    return team?.team_name || team?.display_name || teamNumber;
  };

  // Format team display for bracket (team number + first 7 chars of name)
  const formatBracketDisplay = (
    teamNumber: string,
    teamName: string,
  ): string => {
    if (!teamNumber || teamNumber === 'Bye') return 'Bye';
    const shortName = teamName.substring(0, 7);
    return `${teamNumber} ${shortName}`;
  };

  const handleQueueSelect = (queueId: string) => {
    if (!queueId) {
      setFormData((prev) => {
        const next = { ...prev };
        delete next.team_number;
        delete next.team_name;
        delete next.round;
        delete next.team_id;
        delete next.game_queue_id;
        return next;
      });
      return;
    }
    const item = queueItems.find((q) => q.id === Number(queueId));
    if (!item) return;
    setFormData((prev) => ({
      ...prev,
      team_number: String(item.seeding_team_number),
      team_name: item.seeding_team_name || `Team ${item.seeding_team_number}`,
      round: item.seeding_round,
      team_id: item.seeding_team_id,
      game_queue_id: item.id,
    }));
  };

  const handleDoubleSeedingQueueSelect = (queueId: string) => {
    if (!queueId) {
      setFormData((prev) => {
        const next = { ...prev };
        delete next.team_a_number;
        delete next.team_a_name;
        delete next.team_a_id;
        delete next.team_b_number;
        delete next.team_b_name;
        delete next.team_b_id;
        delete next.round;
        delete next.match_number;
        delete next.double_seeding_match_id;
        delete next.game_queue_id;
        return next;
      });
      return;
    }
    const item = queueItems.find((q) => q.id === Number(queueId));
    if (!item || item.double_seeding_match_id == null) return;

    const updates: Record<string, any> = {
      double_seeding_match_id: item.double_seeding_match_id,
      game_queue_id: item.id,
      round: item.double_seeding_round,
      match_number: item.double_seeding_match_number,
    };

    updates.team_a_number =
      item.double_seeding_team1_number != null
        ? String(item.double_seeding_team1_number)
        : '';
    updates.team_a_name =
      item.double_seeding_team1_name ||
      (item.double_seeding_team1_number != null
        ? `Team ${item.double_seeding_team1_number}`
        : '');
    updates.team_a_id = item.double_seeding_team1_id ?? undefined;

    if (item.double_seeding_team2_id != null) {
      updates.team_b_number =
        item.double_seeding_team2_number != null
          ? String(item.double_seeding_team2_number)
          : '';
      updates.team_b_name =
        item.double_seeding_team2_name ||
        (item.double_seeding_team2_number != null
          ? `Team ${item.double_seeding_team2_number}`
          : '');
      updates.team_b_id = item.double_seeding_team2_id;
    } else {
      // Odd-team lone run: no second team on this match
      updates.team_b_number = 'None';
      updates.team_b_name = 'None (solo run)';
      updates.team_b_id = undefined;
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const formatDoubleSeedingQueueLabel = (
    item: (typeof queueItems)[number],
  ): string => {
    const team1 =
      item.double_seeding_team1_number != null
        ? `#${item.double_seeding_team1_number} ${item.double_seeding_team1_name ?? ''}`.trim()
        : 'TBD';
    const team2 =
      item.double_seeding_team2_id != null
        ? `#${item.double_seeding_team2_number} ${item.double_seeding_team2_name ?? ''}`.trim()
        : 'Solo run';
    return `Round ${item.double_seeding_round} M${item.double_seeding_match_number}: ${team1} vs ${team2}`;
  };

  const handleBracketGameSelect = (selectedValue: string) => {
    setResultType('standard');
    setDisqualifiedSide('');
    setResultNote('');
    const selectedGame = findBracketGameBySelection(
      bracketGames,
      selectedValue,
      isEventScopedBracket,
    );

    if (!selectedGame) {
      setFormData((prev) => {
        const next = { ...prev };
        delete next.game_number;
        delete next.bracket_game_id;
        delete next.team_a_number;
        delete next.team_a_name;
        delete next.team_a_bracket_display;
        delete next.team_b_number;
        delete next.team_b_name;
        delete next.team_b_bracket_display;
        delete next.winner;
        return next;
      });
      return;
    }

    const updates: Record<string, any> = {
      game_number: selectedGame.gameNumber,
      winner: '',
    };

    if (selectedGame.team1) {
      const teamNumRaw = selectedGame.team1.teamNumber;
      const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
      const fullName = lookupTeamName(teamNum);
      updates.team_a_number = teamNum;
      updates.team_a_name = fullName;
      updates.team_a_bracket_display = selectedGame.team1.displayName;
    } else {
      updates.team_a_number = 'Bye';
      updates.team_a_name = 'Bye';
      updates.team_a_bracket_display = 'Bye';
    }

    if (selectedGame.team2) {
      const teamNumRaw = selectedGame.team2.teamNumber;
      const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
      const fullName = lookupTeamName(teamNum);
      updates.team_b_number = teamNum;
      updates.team_b_name = fullName;
      updates.team_b_bracket_display = selectedGame.team2.displayName;
    } else {
      updates.team_b_number = 'Bye';
      updates.team_b_name = 'Bye';
      updates.team_b_bracket_display = 'Bye';
    }

    if (selectedGame.bracketGameId != null) {
      updates.bracket_game_id = selectedGame.bracketGameId;
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleRepeatableGroupInputChange = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field.id]: applyRepeatableGroupInputChange(
        prev[field.id],
        field,
        rowIndex,
        childField.id,
        value,
      ),
    }));
  };

  const handleInputChange = (fieldId: string, value: any, field?: any) => {
    const updates: Record<string, any> = { [fieldId]: value };

    // Handle bracket game selection - populate both teams
    if (fieldId === 'game_number' && isHeadToHead) {
      handleBracketGameSelect(String(value));
      return;
    }

    // Handle cascading fields (e.g., team number selection updates team name)
    if (field?.cascades && !isHeadToHead) {
      const cascadeField = schema.fields.find(
        (f: any) => f.id === field.cascades.targetField,
      );
      if (cascadeField && dynamicData[field.id]) {
        const selectedItem = dynamicData[field.id].find(
          (item: any) => item[field.dataSource.valueField] === value,
        );
        if (selectedItem && field.cascades.sourceField) {
          updates[field.cascades.targetField] =
            selectedItem[field.cascades.sourceField];
        }
      }
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const getFieldStartingValue = (field: any) => getFieldDefaultValue(field);

  const shouldShowNumberPlaceholder = (field: any, value: any) => {
    const startingValue = getFieldStartingValue(field);

    return (
      !touchedFields[field.id] &&
      (value === '' ||
        value === undefined ||
        value === null ||
        value === 0 ||
        value === '0') &&
      (startingValue === undefined ||
        startingValue === null ||
        startingValue === '' ||
        startingValue === 0 ||
        startingValue === '0')
    );
  };

  const getDisplayedNumberValue = (field: any, value: any) => {
    if (shouldShowNumberPlaceholder(field, value)) {
      return '';
    }

    return value ?? '';
  };

  const getNumberPlaceholder = (field: any, value: any) => {
    if (!shouldShowNumberPlaceholder(field, value)) {
      return field.placeholder || '';
    }

    const startingValue = getFieldStartingValue(field);
    if (
      startingValue !== undefined &&
      startingValue !== null &&
      String(startingValue) !== ''
    ) {
      return String(startingValue);
    }

    return field.placeholder || '0';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitScore.isPending) return;
    const submission = calculateScoresheetValues(
      schema.fields,
      formData,
      compilation,
    );
    if (!submission.ok) {
      showNotification(
        'Correct the formula errors before submitting.',
        'error',
      );
      return;
    }

    // Validate winner selection for head-to-head
    if (isHeadToHead && resultType !== 'disqualification' && !formData.winner) {
      alert('Please select a winner before submitting.');
      return;
    }

    if (isHeadToHead && resultType === 'disqualification') {
      if (!disqualifiedSide) {
        alert('Please select the disqualified team before submitting.');
        return;
      }
      if (!resultNote.trim()) {
        alert('Please enter the reason or rule reference for the DQ.');
        return;
      }
    }

    // Validate bracket_game_id for DB-backed bracket submissions
    if (
      isHeadToHead &&
      schema.scoreDestination === 'db' &&
      schema.eventId &&
      schema.bracketSource?.type === 'db' &&
      formData.bracket_game_id == null
    ) {
      alert('Please select a game before submitting.');
      return;
    }

    // Validate game_queue_id for queue-based seeding
    if (useQueueForSeeding && formData.game_queue_id == null) {
      alert('Please select a team and round from the queue before submitting.');
      return;
    }

    // Validate match selection for double seeding
    if (useQueueForDoubleSeeding && formData.double_seeding_match_id == null) {
      alert('Please select a match from the queue before submitting.');
      return;
    }

    if (teamInitialsSlots.length > 0) {
      const initialsError = getMissingTeamInitialsError(
        formData,
        teamInitialsSlots,
      );
      if (initialsError) {
        alert(initialsError);
        return;
      }
    }

    if (
      isHeadToHead &&
      resultType !== 'standard' &&
      !window.confirm(
        resultType === 'no_contest'
          ? 'Submit this match as a no contest? The scoresheet will be kept privately, but no numeric score will be published.'
          : 'Submit this match as a disqualification? The scoresheet and private DQ reason will be retained, but no numeric score will be published.',
      )
    ) {
      return;
    }

    const scoreData: Record<string, any> = {};
    const submitCalculatedValues = submission.values;
    const { derivedByFieldId } = calculateRepeatableGroupDerivedValues(
      schema.fields,
      formData,
    );

    schema.fields.forEach((field: any) => {
      if (isTeamInitialsFieldId(field.id)) {
        return;
      }

      if (field.type === 'section_header' || field.type === 'group_header') {
        return;
      }

      let value;

      if (field.type === 'calculated') {
        value = submitCalculatedValues[field.id] || 0;
      } else if (field.type === 'repeatableGroup') {
        const rows = normalizeRepeatableGroupRows(formData[field.id], field);
        value = field.pruneBlankRows
          ? pruneRepeatableGroupRows(rows, field)
          : rows;
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
        value: value,
        type: field.type,
      };

      if (field.type === 'repeatableGroup' && derivedByFieldId[field.id]) {
        scoreData[field.id].derived = derivedByFieldId[field.id];
      }
    });

    Object.assign(
      scoreData,
      buildRepeatableGroupDerivedScoreEntries(schema.fields, derivedByFieldId),
      buildTeamInitialsScoreEntries(formData, teamInitialsSlots),
    );

    // For head-to-head, determine the winner info
    let participantName = '';
    let matchId = '';

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

      // participantName shows full team info for display
      participantName = `${winnerTeam.number} - ${winnerTeam.name}`;
      matchId = formData.game_number;

      // Add winner info to score data
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
      // winner_display is what gets written to the bracket (team # + first 7 chars)
      scoreData.winner_display = {
        label: 'Winner Display',
        value:
          winnerTeam.bracketDisplay ||
          formatBracketDisplay(winnerTeam.number, winnerTeam.name),
        type: 'text',
      };
    } else if (isDoubleSeeding) {
      const teamALabel = formData.team_a_number
        ? `${formData.team_a_number} - ${formData.team_a_name}`
        : '';
      const teamBLabel =
        formData.team_b_id != null
          ? `${formData.team_b_number} - ${formData.team_b_name}`
          : 'Solo run';
      participantName = `${teamALabel} vs ${teamBLabel}`;
      matchId = formData.round != null ? `Round ${formData.round}` : '';
    } else {
      participantName = scoreData['team_name']?.value || '';
      matchId = scoreData['round']?.value || '';
    }

    // For DB-backed seeding: include event_id, team_id for correct storage
    const eventId = schema.eventId ?? null;
    const scoreDestination = schema.scoreDestination;
    const isDbBackedDoubleSeeding =
      isDoubleSeeding &&
      scoreDestination === 'db' &&
      eventId &&
      formData.double_seeding_match_id != null;
    const isDbBackedSeeding =
      scoreDestination === 'db' && eventId && !isHeadToHead && !isDoubleSeeding;
    const isDbBackedBracket =
      isHeadToHead &&
      scoreDestination === 'db' &&
      eventId &&
      schema.bracketSource?.type === 'db' &&
      formData.bracket_game_id != null;

    if (isDbBackedSeeding && scoreData.team_number?.value) {
      // team_id from queue selection (useQueueForSeeding) or from team dropdown
      const fromQueue = formData.team_id;
      const fromDropdown = (dynamicData.team_number || []).find(
        (t: any) =>
          String(t.team_number || t['Team Number']) ===
          String(scoreData.team_number.value),
      );
      const teamId = fromQueue ?? fromDropdown?.team_id;
      if (teamId != null) {
        scoreData.team_id = {
          label: 'Team ID',
          value: teamId,
          type: 'number',
        };
      }
    }

    if (isDbBackedBracket) {
      // Resolve winner_team_id from teamsData
      const winnerTeamNum =
        formData.winner === 'team_a'
          ? formData.team_a_number
          : formData.team_b_number;
      const winnerTeam = teamsData.find((team) =>
        teamNumberMatches(team, String(winnerTeamNum)),
      );
      if (winnerTeam?.id != null) {
        scoreData.winner_team_id = {
          label: 'Winner Team ID',
          value: winnerTeam.id,
          type: 'number',
        };
      }
      const team1Score =
        submitCalculatedValues.team_a_total ?? formData.team_a_score ?? 0;
      const team2Score =
        submitCalculatedValues.team_b_total ?? formData.team_b_score ?? 0;
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

    let disqualifiedTeamId: number | undefined;
    if (isDbBackedBracket && resultType === 'disqualification') {
      const disqualifiedTeamNumber =
        disqualifiedSide === 'team_a'
          ? formData.team_a_number
          : formData.team_b_number;
      const disqualifiedTeam = teamsData.find((team) =>
        teamNumberMatches(team, String(disqualifiedTeamNumber)),
      );
      disqualifiedTeamId = disqualifiedTeam?.id;
      if (disqualifiedTeamId == null) {
        alert('Could not resolve the disqualified team. Please reload.');
        return;
      }
    }

    if (isDbBackedDoubleSeeding) {
      // Side totals: each team only receives its own side's score
      const teamATotal =
        submitCalculatedValues.team_a_total ?? formData.team_a_score ?? 0;
      const teamBTotal =
        submitCalculatedValues.team_b_total ?? formData.team_b_score ?? 0;
      scoreData.team_a_total = {
        label: 'Team A Total',
        value: teamATotal,
        type: 'number',
      };
      scoreData.team_b_total = {
        label: 'Team B Total',
        value: teamBTotal,
        type: 'number',
      };
      if (formData.team_a_id != null) {
        scoreData.team_a_id = {
          label: 'Team A ID',
          value: formData.team_a_id,
          type: 'number',
        };
      }
      if (formData.team_b_id != null) {
        scoreData.team_b_id = {
          label: 'Team B ID',
          value: formData.team_b_id,
          type: 'number',
        };
      }
      if (formData.round != null) {
        scoreData.round = {
          label: 'Round',
          value: formData.round,
          type: 'number',
        };
      }
    }

    const submitEventId =
      isDbBackedSeeding || isDbBackedBracket || isDbBackedDoubleSeeding
        ? Number(eventId)
        : undefined;

    try {
      await submitScore.mutateAsync({
        sessionGeneration,
        templateId: template.id,
        participantName,
        matchId,
        scoreData,
        isHeadToHead,
        bracketSource: isHeadToHead ? schema.bracketSource : null,
        eventId: submitEventId,
        scoreType: isDbBackedSeeding
          ? 'seeding'
          : isDbBackedBracket
            ? 'bracket'
            : isDbBackedDoubleSeeding
              ? 'double_seeding'
              : undefined,
        game_queue_id: formData.game_queue_id ?? undefined,
        bracket_game_id: isDbBackedBracket
          ? formData.bracket_game_id
          : undefined,
        double_seeding_match_id: isDbBackedDoubleSeeding
          ? formData.double_seeding_match_id
          : undefined,
        resultType: isDbBackedBracket ? resultType : 'standard',
        disqualifiedTeamId,
        resultNote:
          isDbBackedBracket && resultType === 'disqualification'
            ? resultNote.trim()
            : undefined,
      });

      if (!isHeadToHead && !useQueueForSeeding && scoreData['round']?.value) {
        localStorage.setItem(
          'lastRoundNumber',
          String(scoreData['round'].value),
        );
      }

      showNotification('Score submitted successfully!', 'success');

      if (isHeadToHead) {
        setFormData({});
        setResultType('standard');
        setDisqualifiedSide('');
        setResultNote('');
      } else if (useQueueForSeeding || useQueueForDoubleSeeding) {
        setFormData({});
      } else {
        const currentRound = formData['round'];
        setFormData({ round: currentRound });
      }
    } catch (error) {
      if (isAuthorizationError(error)) {
        showNotification(
          error instanceof Error
            ? error.message
            : 'Session expired. Redirecting to scoresheet selection...',
          'error',
        );
        window.setTimeout(() => {
          clearJudgeSessionStorage();
          void removeJudgeQueries(queryClient);
          window.location.href = '/judge';
        }, 2000);
        return;
      }
      console.error('Error submitting score:', error);
      showNotification('Failed to submit score. Please try again.', 'error');
    }
  };

  const handleResultTypeChange = (nextResultType: BracketResultType) => {
    setResultType(nextResultType);
    setDisqualifiedSide('');
    setResultNote('');
    setFormData((previous) => ({ ...previous, winner: '' }));
  };

  const handleDisqualifiedSideChange = (side: 'team_a' | 'team_b') => {
    setDisqualifiedSide(side);
    setFormData((previous) => ({
      ...previous,
      winner: side === 'team_a' ? 'team_b' : 'team_a',
    }));
  };

  const renderBracketResultControls = () => (
    <div className="bracket-result-container">
      <h3 className="winner-select-title">Match Result</h3>
      <div className="bracket-result-options">
        {(
          [
            ['standard', 'Normal score'],
            ['no_contest', 'No contest'],
            ['disqualification', 'Disqualification'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`bracket-result-button ${resultType === value ? 'selected' : ''}`}
            onClick={() => handleResultTypeChange(value)}
            disabled={!formData.game_number}
          >
            {label}
          </button>
        ))}
      </div>

      {resultType === 'no_contest' && (
        <p className="bracket-result-help">
          Select the winner below. The entered scoresheet is retained privately,
          but no point totals will be published.
        </p>
      )}

      {resultType === 'disqualification' && (
        <div className="dq-controls">
          <p className="bracket-result-help">
            Select the team receiving the DQ. The other team will advance.
          </p>
          <div className="bracket-result-options">
            <button
              type="button"
              className={`bracket-result-button danger ${disqualifiedSide === 'team_a' ? 'selected' : ''}`}
              onClick={() => handleDisqualifiedSideChange('team_a')}
            >
              DQ {formData.team_a_number || 'Team A'}
            </button>
            <button
              type="button"
              className={`bracket-result-button danger ${disqualifiedSide === 'team_b' ? 'selected' : ''}`}
              onClick={() => handleDisqualifiedSideChange('team_b')}
            >
              DQ {formData.team_b_number || 'Team B'}
            </button>
          </div>
          <label className="dq-reason-label">
            Private reason or rule reference
            <textarea
              className="score-input dq-reason-input"
              value={resultNote}
              onChange={(event) => setResultNote(event.target.value)}
              maxLength={1000}
              rows={3}
              required
            />
          </label>
        </div>
      )}
    </div>
  );

  const renderWinnerSelect = (field: any) => {
    const teamATotal = calculatedValues['team_a_total'] ?? 'Unavailable';
    const teamBTotal = calculatedValues['team_b_total'] ?? 'Unavailable';
    const teamAName = formData.team_a_name || 'Team A';
    const teamBName = formData.team_b_name || 'Team B';
    const teamANumber = formData.team_a_number || '';
    const teamBNumber = formData.team_b_number || '';
    const selectedWinner = formData.winner;

    return (
      <div key={field.id} className="winner-select-container">
        <h3 className="winner-select-title">
          {resultType === 'no_contest'
            ? 'Select No-Contest Winner'
            : 'Select Winner'}
        </h3>
        <div className="winner-options">
          <button
            type="button"
            className={`winner-button ${selectedWinner === 'team_a' ? 'selected' : ''} ${teamATotal > teamBTotal ? 'leading' : ''}`}
            onClick={() => handleInputChange('winner', 'team_a')}
            disabled={!formData.game_number || formData.team_a_number === 'Bye'}
          >
            <div className="winner-team-info">
              <span className="winner-team-number">{teamANumber}</span>
              <span className="winner-team-name">{teamAName}</span>
            </div>
            <div className="winner-team-score">{teamATotal}</div>
            {selectedWinner === 'team_a' && (
              <div className="winner-badge">✓ WINNER</div>
            )}
          </button>

          <div className="winner-vs">VS</div>

          <button
            type="button"
            className={`winner-button ${selectedWinner === 'team_b' ? 'selected' : ''} ${teamBTotal > teamATotal ? 'leading' : ''}`}
            onClick={() => handleInputChange('winner', 'team_b')}
            disabled={!formData.game_number || formData.team_b_number === 'Bye'}
          >
            <div className="winner-team-info">
              <span className="winner-team-number">{teamBNumber}</span>
              <span className="winner-team-name">{teamBName}</span>
            </div>
            <div className="winner-team-score">{teamBTotal}</div>
            {selectedWinner === 'team_b' && (
              <div className="winner-badge">✓ WINNER</div>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderField = (field: any) => {
    if (isTeamInitialsFieldId(field.id)) {
      return null;
    }

    if (field.type === 'section_header') {
      return (
        <div key={field.id} className="section-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'group_header') {
      return (
        <div key={field.id} className="group-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'winner-select') {
      return renderWinnerSelect(field);
    }

    if (field.type === 'calculated') {
      const calcValue = calculatedValues[field.id] ?? 'Unavailable';
      const className = field.isGrandTotal
        ? 'grand-total-field'
        : field.isTotal
          ? 'total-field'
          : 'subtotal-field';
      return (
        <div key={field.id} className={`score-field ${className}`}>
          <label
            className="score-label"
            style={{
              fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600,
            }}
          >
            {field.label}
          </label>
          <div className="calculated-value">{calcValue}</div>
          <FormulaErrors
            errors={calculation.errors.filter(
              (error) => error.field === field.id,
            )}
          />
        </div>
      );
    }

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
    }

    const value = formData[field.id] !== undefined ? formData[field.id] : '';

    const isCompact =
      field.type === 'number' ||
      field.type === 'buttons' ||
      field.type === 'checkbox';

    if (field.isMultiplier) {
      return (
        <div key={field.id} className="score-field multiplier-field">
          <label className="score-label">
            <span className="multiplier-label">Multiplier:</span> {field.label}
            {field.suffix && <span className="multiplier">{field.suffix}</span>}
          </label>
          {renderFieldInput(field, value, isCompact)}
        </div>
      );
    }

    return (
      <div
        key={field.id}
        className={`score-field ${isCompact ? 'compact' : ''}`}
      >
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        {renderFieldInput(field, value, isCompact)}
      </div>
    );
  };

  const renderRepeatableGroup = (field: any) => {
    const rows = normalizeRepeatableGroupRows(formData[field.id], field);
    const derivedColumns =
      field.derived?.type === 'botballCubeStacks'
        ? [
            { key: 'sortedColor', label: 'Sorted Color' },
            { key: 'equivalent', label: 'Equivalent' },
            { key: 'subtotal', label: 'Subtotal' },
          ]
        : field.derived?.type === 'botballStartBoxCubes'
          ? [{ key: 'subtotal', label: 'Value' }]
          : [];
    const derivedRows = rows.map(
      (row) => calculateRepeatableGroupDerived(field, [row])?.rows[0],
    );

    return (
      <RepeatableGroupTable
        key={field.id}
        field={field}
        rows={rows}
        derivedColumns={derivedColumns}
        derivedRows={derivedRows}
        renderControl={(childField, value, rowIndex) =>
          renderRepeatableGroupInput(field, rowIndex, childField, value)
        }
      />
    );
  };

  const renderRepeatableGroupInput = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => (
    <ScoresheetFieldControl
      field={childField}
      value={value}
      onChange={(nextValue) =>
        handleRepeatableGroupInputChange(field, rowIndex, childField, nextValue)
      }
      required={childField.required}
      numberUi="stepper"
      includeNumberBounds
      placeholder={
        childField.type === 'number'
          ? childField.placeholder || '0'
          : childField.placeholder || ''
      }
      inputClassName="score-input repeatable-group-input"
      numberClassName="score-input repeatable-group-number"
      buttonGroupClassName="score-button-group repeatable-group-buttons"
      checkboxClassName="repeatable-group-checkbox"
    />
  );

  const renderFieldInput = (field: any, value: any, isCompact: boolean) => {
    // Handle bracket data source for game selection
    if (field.dataSource?.type === 'bracket') {
      // Filter out games that already have a winner or have a Bye
      const availableGames = bracketGames.filter((game) => {
        // Exclude games with winners
        if (game.hasWinner) return false;
        // Exclude games where either team is a Bye (null team)
        if (game.team1 === null || game.team2 === null) return false;
        return true;
      });

      return (
        <select
          className="score-input"
          value={
            isEventScopedBracket
              ? String(formData.bracket_game_id ?? '')
              : value
          }
          onChange={(e) => handleBracketGameSelect(e.target.value)}
          required={field.required}
          style={{ width: '250px' }}
        >
          <option value="">Select Game...</option>
          {availableGames.length === 0 ? (
            <option value="" disabled>
              No undecided games available
            </option>
          ) : (
            availableGames.map((game) => {
              return (
                <option
                  key={
                    game.bracketGameId ?? `${game.bracketId}-${game.gameNumber}`
                  }
                  value={getBracketGameOptionValue(game, isEventScopedBracket)}
                >
                  {formatBracketGameOptionLabel(game)}
                </option>
              );
            })
          )}
        </select>
      );
    }

    return (
      <ScoresheetFieldControl
        field={field}
        value={value}
        onChange={(nextValue) => {
          if (field.type === 'number') {
            setTouchedFields((prev) => ({
              ...prev,
              [field.id]: nextValue !== '',
            }));
          }
          handleInputChange(field.id, nextValue, field);
        }}
        required={field.required}
        disabled={field.autoPopulated}
        isCompact={isCompact}
        numberUi="judge"
        includeNumberBounds
        displayedNumberValue={getDisplayedNumberValue(field, value)}
        numberPlaceholder={getNumberPlaceholder(field, value)}
        placeholder={field.placeholder || ''}
        options={
          field.dataSource && dynamicData[field.id]
            ? dynamicData[field.id].map((item: any) => ({
                value: item[field.dataSource.valueField],
                label: item[field.dataSource.labelField],
              }))
            : field.options
        }
      />
    );
  };

  // Filter header fields - exclude auto-populated team fields in head-to-head mode
  // When using queue for seeding, exclude team_number, team_name, round (replaced by queue selector)
  const eventId = Number(schema.eventId);
  const chatEnabled = Number.isInteger(eventId) && eventId > 0;

  const headerFields = schema.fields.filter((f: any) => {
    if (f.column) return false;
    if (
      f.type === 'section_header' ||
      f.type === 'group_header' ||
      f.type === 'calculated'
    )
      return false;
    if (f.type === 'winner-select') return false;
    if (isTeamInitialsFieldId(f.id)) return false;
    if (
      useQueueForSeeding &&
      ['team_number', 'team_name', 'round'].includes(f.id)
    )
      return false;
    return true;
  });

  const formContent = (
    <>
      {/* Notification overlay */}
      {notification && (
        <div className={`notification-overlay ${notification.type}`}>
          <div className="notification-content">
            {notification.type === 'success' ? '✓' : '✕'} {notification.message}
          </div>
        </div>
      )}

      {/* Game Areas overlay */}
      {showGameAreas && gameAreasImage && (
        <div
          className="game-areas-overlay"
          onClick={() => setShowGameAreas(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
            cursor: 'pointer',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '95vw',
              maxHeight: '95vh',
            }}
          >
            <button
              onClick={() => setShowGameAreas(false)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                fontSize: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              ×
            </button>
            <img
              src={gameAreasImage}
              alt="Game Areas"
              style={{
                maxWidth: '100%',
                maxHeight: '90vh',
                borderRadius: '0.5rem',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="scoresheet-form"
        noValidate={isHeadToHead && resultType !== 'standard'}
      >
        <FormulaErrors errors={calculation.errors} summary />
        <FormulaErrors errors={calculation.errors} summary />
        {resourceQuery?.isError ? (
          <QueryFeedback query={resourceQuery as never} />
        ) : null}
        {/* Title row: Reset | title | Event Staff */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '1.5rem',
            paddingBottom: '1rem',
            borderBottom: '2px solid var(--border-color)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.8rem',
              minWidth: '60px',
            }}
          >
            Reset
          </button>

          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '1.5rem',
              fontWeight: 700,
            }}
          >
            {schema.title || ''}
          </div>

          {chatEnabled ? (
            <JudgeChatButton />
          ) : (
            <div style={{ minWidth: '60px' }} />
          )}
        </div>

        {/* Game Areas button */}
        {gameAreasImage && (
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowGameAreas(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.5rem',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM3 5h18v14H3V5zm8 6H7v2h4v-2zm0-4H7v2h4V7zm0 8H7v2h4v-2zm6-4h-4v2h4v-2zm0-4h-4v2h4V7zm0 8h-4v2h4v-2z" />
              </svg>
              Game Areas
            </button>
          </div>
        )}

        {useQueueForSeeding && (
          <div className="score-field" style={{ marginBottom: '1rem' }}>
            <label className="score-label">Select from Queue</label>
            <select
              className="score-input"
              value={formData.game_queue_id ?? ''}
              onChange={(e) => handleQueueSelect(e.target.value)}
              required
              style={{ width: '100%', maxWidth: '400px' }}
            >
              <option value="">Select team and round...</option>
              {queueItems.length === 0 ? (
                <option value="" disabled>
                  No queue items available
                </option>
              ) : (
                queueItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.seeding_team_number} {item.seeding_team_name} – Round{' '}
                    {item.seeding_round}
                  </option>
                ))
              )}
            </select>
            {formData.game_queue_id && (
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--secondary-color)',
                }}
              >
                Team {formData.team_number} – {formData.team_name} (Round{' '}
                {formData.round})
              </div>
            )}
          </div>
        )}

        {useQueueForDoubleSeeding && (
          <div className="score-field" style={{ marginBottom: '1rem' }}>
            <label className="score-label">Select Match from Queue</label>
            <select
              className="score-input"
              value={formData.game_queue_id ?? ''}
              onChange={(e) => handleDoubleSeedingQueueSelect(e.target.value)}
              required
              style={{ width: '100%', maxWidth: '400px' }}
            >
              <option value="">Select match...</option>
              {queueItems.length === 0 ? (
                <option value="" disabled>
                  No queue items available
                </option>
              ) : (
                queueItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatDoubleSeedingQueueLabel(item)}
                  </option>
                ))
              )}
            </select>
            {formData.double_seeding_match_id && (
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--secondary-color)',
                }}
              >
                Round {formData.round}, Match {formData.match_number}:{' '}
                {formData.team_a_number} {formData.team_a_name} vs{' '}
                {formData.team_b_id != null
                  ? `${formData.team_b_number} ${formData.team_b_name}`
                  : 'Solo run'}
              </div>
            )}
          </div>
        )}

        <div className="scoresheet-header-fields">
          {headerFields.map(renderField)}
        </div>

        {schema.layout === 'two-column' ? (
          <div className="scoresheet-columns">
            <div className="scoresheet-column">
              {schema.fields
                .filter((f: any) => f.column === 'left')
                .map(renderField)}
            </div>
            <div className="scoresheet-column">
              {schema.fields
                .filter((f: any) => f.column === 'right')
                .map(renderField)}
            </div>
          </div>
        ) : (
          <div>
            {schema.fields
              .filter(
                (f: any) =>
                  !f.column &&
                  f.type !== 'section_header' &&
                  f.type !== 'group_header' &&
                  f.type !== 'winner-select',
              )
              .map(renderField)}
          </div>
        )}

        {isHeadToHead &&
          schema.scoreDestination === 'db' &&
          renderBracketResultControls()}

        {/* Winner selection for head-to-head mode */}
        {isHeadToHead &&
          resultType !== 'disqualification' &&
          schema.fields
            .filter((f: any) => f.type === 'winner-select')
            .map(renderField)}

        {/* Render grand total if it exists (no column specified) */}
        {schema.fields.filter((f: any) => f.isGrandTotal).map(renderField)}

        <TeamInitialsFields
          slots={teamInitialsSlots}
          values={formData}
          onChange={handleInputChange}
          required={resultType === 'standard'}
        />

        <div className="scoresheet-footer">
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={!calculation.ok || submitScore.isPending}
          >
            {isHeadToHead
              ? resultType === 'standard'
                ? 'Submit Winner'
                : resultType === 'no_contest'
                  ? 'Submit No Contest'
                  : 'Submit Disqualification'
              : 'Submit Score'}
          </button>
        </div>
      </form>
    </>
  );

  if (chatEnabled) {
    return (
      <JudgeChatProvider eventId={eventId} mode="judge">
        {formContent}
        <JudgeChatDrawer eventName={schema.title} />
      </JudgeChatProvider>
    );
  }

  return formContent;
}
