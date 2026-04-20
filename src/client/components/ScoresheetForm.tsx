import React, { useState, useEffect } from 'react';
import {
  type ScoresheetField,
  type ScoresheetSchema,
} from '../../shared/domain/scoresheetSchema';
import {
  type BracketGameOption,
  findBracketGameBySelection,
  getBracketSourceEventId,
  isEventScopedBracketSource,
} from './scoresheetUtils';
import { ScoresheetFieldList } from './scoresheet/ScoresheetFieldList';
import { useCalculatedValues } from './scoresheet/formulaEngine';
import '../pages/Scoresheet.css';

interface ScoresheetFormProps {
  template: { id: number; schema: ScoresheetSchema };
}

interface QueueItem {
  id: number;
  queue_type: string;
  seeding_team_id: number;
  seeding_round: number;
  seeding_team_number: number;
  seeding_team_name: string;
  queue_position: number;
  status: string;
}

export default function ScoresheetForm({ template }: ScoresheetFormProps) {
  const schema = template.schema;
  const isHeadToHead = schema.mode === 'head-to-head';
  const gameAreasImage = schema.gameAreasImage;
  const isEventScopedBracket = isEventScopedBracketSource(
    schema.bracketSource,
    schema.eventId,
  );
  const bracketSourceEventId = getBracketSourceEventId(
    schema.bracketSource,
    schema.eventId,
  );

  const useQueueForSeeding = !!(
    schema.eventId &&
    schema.scoreDestination === 'db' &&
    !isHeadToHead
  );

  const getInitialFormData = (): Record<string, unknown> => {
    const initial: Record<string, unknown> = {};
    if (!useQueueForSeeding) {
      const cachedRound = localStorage.getItem('lastRoundNumber');
      if (cachedRound) initial.round = cachedRound;
    }

    schema.fields.forEach((field) => {
      if ('defaultValue' in field && field.defaultValue !== undefined) {
        initial[field.id] = field.defaultValue;
      } else if ('startValue' in field && field.startValue !== undefined) {
        initial[field.id] = field.startValue;
      }
    });

    return initial;
  };

  const [formData, setFormData] =
    useState<Record<string, unknown>>(getInitialFormData);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {},
  );
  const [dynamicData, setDynamicData] = useState<
    Record<string, Array<Record<string, unknown>>>
  >({});
  const [bracketGames, setBracketGames] = useState<BracketGameOption[]>([]);
  const [teamsData, setTeamsData] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [showGameAreas, setShowGameAreas] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  const calculatedValues = useCalculatedValues(schema.fields, formData);

  const showNotification = (
    message: string,
    type: 'success' | 'error' = 'success',
  ) => {
    setNotification({ message, type });

    setTimeout(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }, 100);

    setTimeout(() => {
      setNotification(null);
    }, 2000);
  };

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

  useEffect(() => {
    loadDynamicData();

    if (useQueueForSeeding && schema.eventId) {
      loadQueue();
      const interval = setInterval(() => loadQueue(), 5000);
      return () => clearInterval(interval);
    }

    if (isHeadToHead && schema.bracketSource) {
      loadBracketGames();
      loadTeamsData();

      const interval = setInterval(() => {
        loadBracketGames();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [schema, useQueueForSeeding, isHeadToHead]);

  const loadQueue = async () => {
    if (!schema.eventId) return;
    try {
      const statuses = [
        'queued',
        'called',
        'arrived',
        'on_table',
        'scored',
      ].join(',');
      const url = `/queue/event/${schema.eventId}?queue_type=seeding&status=${statuses}&sync=1`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      setQueueItems(data);
    } catch (error) {
      console.error('Error loading queue:', error);
    }
  };

  const loadBracketGames = async () => {
    try {
      const bracketSource = schema.bracketSource;
      if (!bracketSource) return;

      if (
        bracketSource.type === 'db' &&
        isEventScopedBracket &&
        bracketSourceEventId
      ) {
        const response = await fetch(
          `/brackets/event/${bracketSourceEventId}/games?eligible=scoreable`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to load bracket games from DB:', errorData);
          return;
        }
        const dbGames = await response.json();
        const mapped: BracketGameOption[] = dbGames.map(
          (g: Record<string, unknown>) => mapDbGame(g),
        );
        setBracketGames(mapped);
      } else if (bracketSource.type === 'db' && bracketSource.bracketId) {
        const response = await fetch(
          `/brackets/${bracketSource.bracketId}/games`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to load bracket games from DB:', errorData);
          return;
        }
        const dbGames = await response.json();
        const mapped: BracketGameOption[] = dbGames.map(
          (g: Record<string, unknown>) =>
            mapDbGame(g, bracketSource.bracketId ?? undefined),
        );
        setBracketGames(mapped);
      } else {
        setBracketGames([]);
      }
    } catch (error) {
      console.error('Error loading bracket games:', error);
    }
  };

  const mapDbGame = (
    g: Record<string, unknown>,
    fallbackBracketId?: number,
  ): BracketGameOption => {
    const team1 =
      g.team1_id != null && (g.team1_number != null || g.team1_name)
        ? {
            teamNumber: String(g.team1_number ?? g.team1_name ?? ''),
            displayName: String(
              g.team1_display || g.team1_name || g.team1_number,
            ),
          }
        : null;
    const team2 =
      g.team2_id != null && (g.team2_number != null || g.team2_name)
        ? {
            teamNumber: String(g.team2_number ?? g.team2_name ?? ''),
            displayName: String(
              g.team2_display || g.team2_name || g.team2_number,
            ),
          }
        : null;
    return {
      gameNumber: g.game_number as number,
      bracketId: (g.bracket_id as number) ?? fallbackBracketId,
      bracketName: g.bracket_name as string | null | undefined,
      roundName: g.round_name as string | null | undefined,
      bracketSide: g.bracket_side as string | null | undefined,
      queuePosition: (g.queue_position as number | null | undefined) ?? null,
      team1,
      team2,
      hasWinner: !!g.winner_id || g.status === 'completed',
      bracketGameId: (g.bracket_game_id as number) ?? (g.id as number),
    };
  };

  const loadTeamsData = async () => {
    try {
      const teamsConfig = schema.teamsDataSource;
      if (teamsConfig?.type === 'db' && teamsConfig?.eventId) {
        const response = await fetch(`/teams/event/${teamsConfig.eventId}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          console.error('Failed to load teams data from DB');
          return;
        }
        const data = await response.json();
        setTeamsData(data);
      }
    } catch (error) {
      console.error('Error loading teams data:', error);
    }
  };

  const lookupTeamName = (teamNumber: string): string => {
    if (!teamNumber || teamNumber === 'Bye') return 'Bye';

    const teamsConfig = schema.teamsDataSource;
    const teamNumberField = teamsConfig?.teamNumberField || 'Team Number';
    const teamNameField = teamsConfig?.teamNameField || 'Team Name';

    const normalizedTeamNumber = String(parseInt(teamNumber, 10) || teamNumber);

    const team = teamsData.find((t) => {
      const storedNumber = String(
        parseInt(String(t[teamNumberField]), 10) || t[teamNumberField],
      );
      const storedNumberAlt1 = String(
        parseInt(String(t['Team #']), 10) || t['Team #'],
      );
      const storedNumberAlt2 = String(
        parseInt(String(t['Team Number']), 10) || t['Team Number'],
      );
      const storedNumberAlt3 = String(
        parseInt(String(t['team_number']), 10) || t['team_number'],
      );

      return (
        storedNumber === normalizedTeamNumber ||
        storedNumberAlt1 === normalizedTeamNumber ||
        storedNumberAlt2 === normalizedTeamNumber ||
        storedNumberAlt3 === normalizedTeamNumber
      );
    });

    if (team) {
      return String(
        team[teamNameField] ||
          team['Team Name'] ||
          team['Name'] ||
          team['team_name'] ||
          team['display_name'] ||
          teamNumber,
      );
    }

    return teamNumber;
  };

  const formatBracketDisplay = (
    teamNumber: string,
    teamName: string,
  ): string => {
    if (!teamNumber || teamNumber === 'Bye') return 'Bye';
    const shortName = teamName.substring(0, 7);
    return `${teamNumber} ${shortName}`;
  };

  const loadDynamicData = async () => {
    const fieldsWithDataSource = schema.fields.filter(
      (f) =>
        f.dataSource &&
        f.dataSource.type !== 'bracket' &&
        !(useQueueForSeeding && f.id === 'team_number'),
    );

    for (const field of fieldsWithDataSource) {
      try {
        const ds = field.dataSource;
        if (!ds) continue;

        if (ds.type === 'db' && ds.eventId) {
          const response = await fetch(`/teams/event/${ds.eventId}`, {
            credentials: 'include',
          });
          if (!response.ok) {
            console.error(`Failed to load ${field.id} from DB`);
            continue;
          }
          const raw = await response.json();
          const labelField = ds.labelField || 'team_number';
          const valueField = ds.valueField || 'team_number';

          let data = raw.map((t: Record<string, unknown>) => ({
            [labelField]: String(t.team_number),
            [valueField]: String(t.team_number),
            team_name: t.team_name || t.display_name,
            team_id: t.id,
            'Team Number': String(t.team_number),
            'Team Name': t.team_name || t.display_name,
          }));

          data = data.sort(
            (a: Record<string, unknown>, b: Record<string, unknown>) => {
              const aVal = String(a[labelField] || '');
              const bVal = String(b[labelField] || '');
              const aNum = parseFloat(aVal);
              const bNum = parseFloat(bVal);
              if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
              return aVal.localeCompare(bVal, undefined, {
                numeric: true,
                sensitivity: 'base',
              });
            },
          );

          setDynamicData((prev) => ({ ...prev, [field.id]: data }));
        }
      } catch (error) {
        console.error(`Error loading data for ${field.id}:`, error);
      }
    }
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

  const handleBracketGameSelect = (selectedValue: string) => {
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

    const updates: Record<string, unknown> = {
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

  const handleInputChange = (
    fieldId: string,
    value: unknown,
    field?: ScoresheetField,
  ) => {
    if (fieldId === 'game_number' && isHeadToHead) {
      handleBracketGameSelect(String(value));
      return;
    }

    const updates: Record<string, unknown> = { [fieldId]: value };

    if (
      field &&
      'cascades' in field &&
      field.cascades &&
      !isHeadToHead &&
      field.dataSource?.type === 'db'
    ) {
      const cascades = field.cascades as Record<string, string>;
      const targetField = cascades.targetField;
      const sourceField = cascades.sourceField;
      if (targetField && sourceField) {
        const cascadeField = schema.fields.find((f) => f.id === targetField);
        const ds = field.dataSource;
        const valueField =
          ds && ds.type === 'db' ? ds.valueField || 'value' : 'value';
        if (cascadeField && dynamicData[field.id]) {
          const selectedItem = dynamicData[field.id].find(
            (item) => item[valueField] === value,
          );
          if (selectedItem) {
            updates[targetField] = selectedItem[sourceField];
          }
        }
      }
    }

    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleNumberInputTouched = (fieldId: string, touched: boolean) => {
    setTouchedFields((prev) => ({ ...prev, [fieldId]: touched }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isHeadToHead && !formData.winner) {
      alert('Please select a winner before submitting.');
      return;
    }

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

    if (useQueueForSeeding && formData.game_queue_id == null) {
      alert('Please select a team and round from the queue before submitting.');
      return;
    }

    const scoreData: Record<
      string,
      { label: string; value: unknown; type: string }
    > = {};

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

    try {
      const response = await fetch('/api/scores/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
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
          bracket_game_id: isDbBackedBracket
            ? formData.bracket_game_id
            : undefined,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        const data = await response.json().catch(() => ({}));
        const msg =
          (data as { error?: string }).error ||
          'Session expired. Redirecting to scoresheet selection...';
        showNotification(msg, 'error');
        sessionStorage.removeItem('currentTemplate');
        setTimeout(() => {
          window.location.href = '/judge';
        }, 2000);
        return;
      }
      if (!response.ok) throw new Error('Failed to submit score');

      if (!isHeadToHead && !useQueueForSeeding && scoreData['round']?.value) {
        localStorage.setItem(
          'lastRoundNumber',
          String(scoreData['round'].value),
        );
      }

      showNotification('Score submitted successfully!', 'success');

      if (isHeadToHead) {
        setFormData({});
        loadBracketGames();
      } else if (useQueueForSeeding) {
        setFormData({});
        loadQueue();
      } else {
        const currentRound = formData['round'];
        setFormData({ round: currentRound });
      }
    } catch (error) {
      console.error('Error submitting score:', error);
      showNotification('Failed to submit score. Please try again.', 'error');
    }
  };

  const renderWinnerSelect = (field: ScoresheetField) => {
    const teamATotal = calculatedValues['team_a_total'] || 0;
    const teamBTotal = calculatedValues['team_b_total'] || 0;
    const teamAName = (formData.team_a_name as string) || 'Team A';
    const teamBName = (formData.team_b_name as string) || 'Team B';
    const teamANumber = (formData.team_a_number as string) || '';
    const teamBNumber = (formData.team_b_number as string) || '';
    const selectedWinner = formData.winner;

    return (
      <div key={field.id} className="winner-select-container">
        <h3 className="winner-select-title">Select Winner</h3>
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

  return (
    <>
      {notification && (
        <div className={`notification-overlay ${notification.type}`}>
          <div className="notification-content">
            {notification.type === 'success' ? '✓' : '✕'} {notification.message}
          </div>
        </div>
      )}

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

      <form onSubmit={handleSubmit} className="scoresheet-form">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '1.5rem',
            paddingBottom: '1rem',
            borderBottom: '2px solid var(--border-color)',
          }}
        >
          <div style={{ width: '60px' }}></div>

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

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.8rem',
              width: '60px',
            }}
          >
            Reset
          </button>
        </div>

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
              value={
                (formData.game_queue_id as string | number | undefined) ?? ''
              }
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
            {formData.game_queue_id != null && (
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--secondary-color)',
                }}
              >
                Team {String(formData.team_number)} –{' '}
                {String(formData.team_name)} (Round {String(formData.round)})
              </div>
            )}
          </div>
        )}

        <ScoresheetFieldList
          schema={schema}
          mode="edit"
          formData={formData}
          calculatedValues={calculatedValues}
          touchedFields={touchedFields}
          onChange={handleInputChange}
          onNumberInputTouched={handleNumberInputTouched}
          dynamicData={dynamicData}
          bracket={{
            games: bracketGames,
            eventScoped: isEventScopedBracket,
            selectedGameId:
              (formData.bracket_game_id as number | string | undefined) ?? '',
            onSelect: handleBracketGameSelect,
          }}
          renderWinnerSelect={renderWinnerSelect}
          excludeHeaderFieldId={(id) =>
            useQueueForSeeding &&
            ['team_number', 'team_name', 'round'].includes(id)
          }
          showTitle={false}
          formClassName=""
        />

        <div className="scoresheet-footer">
          <button type="submit" className="btn btn-primary btn-large">
            {isHeadToHead ? 'Submit Winner' : 'Submit Score'}
          </button>
        </div>
      </form>
    </>
  );
}
