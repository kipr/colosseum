/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import '../pages/Scoresheet.css';

interface BracketGame {
  gameNumber: number;
  team1: { teamNumber: string; displayName: string } | null;
  team2: { teamNumber: string; displayName: string } | null;
  hasWinner?: boolean;
  winner?: string;
  bracketGameId?: number; // DB bracket_games.id for DB-backed submissions
}

interface ScoresheetFormProps {
  template: any;
}

export default function ScoresheetForm({ template }: ScoresheetFormProps) {
  const schema = template.schema;
  const isHeadToHead = schema.mode === 'head-to-head';
  const gameAreasImage = schema.gameAreasImage;

  // Use queue for DB-backed seeding: replace team+round selection with queue picker
  const useQueueForSeeding =
    schema.eventId && schema.scoreDestination === 'db' && !isHeadToHead;

  // Helper to get initial form data with default values from schema
  const getInitialFormData = () => {
    const initial: Record<string, any> = {};
    if (!useQueueForSeeding) {
      const cachedRound = localStorage.getItem('lastRoundNumber');
      if (cachedRound) initial.round = cachedRound;
    }

    // Initialize fields with their default values if specified
    template.schema.fields.forEach((field: any) => {
      if (field.defaultValue !== undefined) {
        initial[field.id] = field.defaultValue;
      } else if (field.startValue !== undefined) {
        // Support both defaultValue and startValue
        initial[field.id] = field.startValue;
      }
    });

    return initial;
  };

  const [formData, setFormData] =
    useState<Record<string, any>>(getInitialFormData);
  const [dynamicData, setDynamicData] = useState<Record<string, any[]>>({});
  const [bracketGames, setBracketGames] = useState<BracketGame[]>([]);
  const [teamsData, setTeamsData] = useState<any[]>([]); // Teams lookup for head-to-head
  const [calculatedValues, setCalculatedValues] = useState<
    Record<string, number>
  >({});
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [showGameAreas, setShowGameAreas] = useState(false);

  const [queueItems, setQueueItems] = useState<
    Array<{
      id: number;
      queue_type: string;
      seeding_team_id: number;
      seeding_round: number;
      seeding_team_number: number;
      seeding_team_name: string;
      queue_position: number;
      status: string;
    }>
  >([]);

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
      setCalculatedValues({});
      showNotification('Form has been reset', 'success');
    }
  };

  // Recalculate all formulas when form data changes
  useEffect(() => {
    calculateAllFormulas();
  }, [formData]);

  useEffect(() => {
    // Load dynamic dropdown data (skip team_number when using queue)
    loadDynamicData();

    // Load queue for DB-backed seeding
    if (useQueueForSeeding && schema.eventId) {
      loadQueue();
      const interval = setInterval(() => loadQueue(), 5000);
      return () => clearInterval(interval);
    }

    // Load bracket games if head-to-head mode
    if (isHeadToHead && schema.bracketSource) {
      loadBracketGames();
      loadTeamsData();

      // Poll for bracket updates every 5 seconds so new games appear as winners are decided
      const interval = setInterval(() => {
        loadBracketGames();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, []);

  const loadQueue = async () => {
    if (!schema.eventId) return;
    try {
      const statuses = ['queued', 'called', 'in_progress'].join(',');
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

      if (bracketSource.type === 'db' && bracketSource.bracketId) {
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
        const mapped: BracketGame[] = dbGames.map((g: any) => {
          const team1 =
            g.team1_id != null && (g.team1_number != null || g.team1_name)
              ? {
                  teamNumber: String(g.team1_number ?? g.team1_name ?? ''),
                  displayName:
                    g.team1_display || g.team1_name || String(g.team1_number),
                }
              : null;
          const team2 =
            g.team2_id != null && (g.team2_number != null || g.team2_name)
              ? {
                  teamNumber: String(g.team2_number ?? g.team2_name ?? ''),
                  displayName:
                    g.team2_display || g.team2_name || String(g.team2_number),
                }
              : null;
          return {
            gameNumber: g.game_number,
            team1,
            team2,
            hasWinner: !!g.winner_id || g.status === 'completed',
            bracketGameId: g.id,
          };
        });
        setBracketGames(mapped);
      } else {
        // Legacy: spreadsheet-based bracket games
        const sheetName = bracketSource.sheetName || 'DE 16 Team';
        const url = `/data/bracket-games/${sheetName}?templateId=${template.id}`;
        const response = await fetch(url);
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to load bracket games:', errorData);
          return;
        }
        const games = await response.json();
        setBracketGames(games);
      }
    } catch (error) {
      console.error('Error loading bracket games:', error);
    }
  };

  // Load teams data for looking up full team names in head-to-head mode
  const loadTeamsData = async () => {
    try {
      const teamsConfig = schema.teamsDataSource;

      // DB backend: load teams from event
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
        return;
      }

      // Legacy: spreadsheet-based teams
      const sheetName = teamsConfig?.sheetName || 'Teams';
      const url = `/data/sheet-data/${sheetName}?templateId=${template.id}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error('Failed to load teams data for name lookup');
        return;
      }

      const data = await response.json();
      setTeamsData(data);
    } catch (error) {
      console.error('Error loading teams data:', error);
    }
  };

  // Look up full team name from Teams data using team number
  const lookupTeamName = (teamNumber: string): string => {
    if (!teamNumber || teamNumber === 'Bye') return 'Bye';

    // Use field names from teamsDataSource config, or common defaults
    const teamsConfig = schema.teamsDataSource;
    const teamNumberField = teamsConfig?.teamNumberField || 'Team Number';
    const teamNameField = teamsConfig?.teamNameField || 'Team Name';

    // Normalize team number by stripping leading zeros (e.g., "001" -> "1")
    const normalizedTeamNumber = String(parseInt(teamNumber, 10) || teamNumber);

    const team = teamsData.find((t: any) => {
      // Normalize the stored team number as well for comparison
      const storedNumber = String(
        parseInt(t[teamNumberField], 10) || t[teamNumberField],
      );
      const storedNumberAlt1 = String(parseInt(t['Team #'], 10) || t['Team #']);
      const storedNumberAlt2 = String(
        parseInt(t['Team Number'], 10) || t['Team Number'],
      );
      const storedNumberAlt3 = String(
        parseInt(t['team_number'], 10) || t['team_number'],
      );

      return (
        storedNumber === normalizedTeamNumber ||
        storedNumberAlt1 === normalizedTeamNumber ||
        storedNumberAlt2 === normalizedTeamNumber ||
        storedNumberAlt3 === normalizedTeamNumber
      );
    });

    if (team) {
      return (
        team[teamNameField] ||
        team['Team Name'] ||
        team['Name'] ||
        team['team_name'] ||
        team['display_name'] ||
        teamNumber
      );
    }

    return teamNumber; // Fallback to team number if not found
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

  const loadDynamicData = async () => {
    const fieldsWithDataSource = schema.fields.filter(
      (f: any) =>
        f.dataSource &&
        f.dataSource.type !== 'bracket' &&
        // Skip team_number when using queue - it gets populated from queue selection
        !(useQueueForSeeding && f.id === 'team_number'),
    );

    for (const field of fieldsWithDataSource) {
      try {
        const ds = field.dataSource;

        // DB backend: load teams from event for dropdown
        if (ds.type === 'db' && ds.eventId) {
          const response = await fetch(`/teams/event/${ds.eventId}`, {
            credentials: 'include',
          });
          if (!response.ok) {
            console.error(`Failed to load ${field.id} from DB`);
            continue;
          }
          let data = await response.json();
          const labelField = ds.labelField || 'team_number';
          const valueField = ds.valueField || 'team_number';

          // Map DB format to dropdown format (labelField/valueField for cascades)
          // Include id for score submission (team_id for seeding_scores)
          data = data.map((t: any) => ({
            [labelField]: String(t.team_number),
            [valueField]: String(t.team_number),
            team_name: t.team_name || t.display_name,
            team_id: t.id,
            'Team Number': String(t.team_number),
            'Team Name': t.team_name || t.display_name,
          }));

          data = data.sort((a: any, b: any) => {
            const aVal = String(a[labelField] || '');
            const bVal = String(b[labelField] || '');
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return aVal.localeCompare(bVal, undefined, {
              numeric: true,
              sensitivity: 'base',
            });
          });

          setDynamicData((prev) => ({ ...prev, [field.id]: data }));
          continue;
        }

        // Legacy: spreadsheet-based data
        const { sheetName, range, labelField } = ds;
        const url = `/data/sheet-data/${sheetName}?range=${range || ''}&templateId=${template.id}`;
        const response = await fetch(url);

        if (!response.ok) {
          const errorData = await response.json();
          console.error(`Failed to load ${field.id}:`, errorData);
          continue;
        }

        let data = await response.json();

        // Sort data alphanumerically by the label field
        data = data.sort((a: any, b: any) => {
          const aVal = String(a[labelField] || '');
          const bVal = String(b[labelField] || '');

          const aNum = parseFloat(aVal);
          const bNum = parseFloat(bVal);

          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }

          return aVal.localeCompare(bVal, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        });

        setDynamicData((prev) => ({ ...prev, [field.id]: data }));
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

  const handleInputChange = (fieldId: string, value: any, field?: any) => {
    const updates: Record<string, any> = { [fieldId]: value };

    // Handle bracket game selection - populate both teams
    if (fieldId === 'game_number' && isHeadToHead) {
      if (!value) {
        updates.bracket_game_id = undefined;
      }
      const selectedGame = bracketGames.find(
        (g) => g.gameNumber === Number(value),
      );
      if (selectedGame) {
        if (selectedGame.team1) {
          const teamNumRaw = selectedGame.team1.teamNumber;
          // Normalize team number (strip leading zeros)
          const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
          const fullName = lookupTeamName(teamNum);
          updates.team_a_number = teamNum;
          updates.team_a_name = fullName;
          // Store the original bracket display format for when we write the winner
          updates.team_a_bracket_display = selectedGame.team1.displayName;
        } else {
          updates.team_a_number = 'Bye';
          updates.team_a_name = 'Bye';
          updates.team_a_bracket_display = 'Bye';
        }
        if (selectedGame.team2) {
          const teamNumRaw = selectedGame.team2.teamNumber;
          // Normalize team number (strip leading zeros)
          const teamNum = String(parseInt(teamNumRaw, 10) || teamNumRaw);
          const fullName = lookupTeamName(teamNum);
          updates.team_b_number = teamNum;
          updates.team_b_name = fullName;
          // Store the original bracket display format for when we write the winner
          updates.team_b_bracket_display = selectedGame.team2.displayName;
        } else {
          updates.team_b_number = 'Bye';
          updates.team_b_name = 'Bye';
          updates.team_b_bracket_display = 'Bye';
        }
        // Store bracket_game_id for DB-backed submissions
        if (selectedGame.bracketGameId != null) {
          updates.bracket_game_id = selectedGame.bracketGameId;
        } else {
          delete updates.bracket_game_id;
        }
        // Reset winner when game changes
        updates.winner = '';
      }
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

  const calculateAllFormulas = () => {
    const calculated: Record<string, number> = {};

    schema.fields.forEach((field: any) => {
      if (field.type === 'calculated' && field.formula) {
        try {
          const result = evaluateFormula(field.formula, formData, calculated);
          calculated[field.id] = result;
        } catch (error) {
          console.error(`Error calculating ${field.id}:`, error);
          calculated[field.id] = 0;
        }
      }
    });

    setCalculatedValues(calculated);
  };

  const evaluateFormula = (
    formula: string,
    data: Record<string, any>,
    calculated: Record<string, number>,
  ): number => {
    let expression = formula;
    const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
    const uniqueFieldIds = Array.from(new Set(fieldIds));

    uniqueFieldIds.forEach((fieldId) => {
      let value: any = 0;

      if (calculated[fieldId] !== undefined) {
        value = calculated[fieldId];
      } else if (data[fieldId] !== undefined && data[fieldId] !== '') {
        value = data[fieldId];
      }

      let replacement: string;

      if (formula.includes(`${fieldId} ===`)) {
        replacement = `'${String(value)}'`;
      } else if (typeof value === 'string') {
        replacement = String(Number(value) || 0);
      } else if (typeof value === 'boolean') {
        replacement = value ? '1' : '0';
      } else {
        replacement = String(Number(value) || 0);
      }

      const regex = new RegExp(`\\b${fieldId}\\b`, 'g');
      expression = expression.replace(regex, replacement);
    });

    try {
      const result = eval(expression);
      return Number(result) || 0;
    } catch (error) {
      console.error(
        'Formula evaluation error:',
        error,
        'Formula:',
        formula,
        'Expression:',
        expression,
      );
      return 0;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate winner selection for head-to-head
    if (isHeadToHead && !formData.winner) {
      alert('Please select a winner before submitting.');
      return;
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

    const scoreData: Record<string, any> = {};

    schema.fields.forEach((field: any) => {
      if (field.type === 'section_header' || field.type === 'group_header') {
        return;
      }

      let value;

      if (field.type === 'calculated') {
        value = calculatedValues[field.id] || 0;
      } else {
        value =
          formData[field.id] !== undefined
            ? formData[field.id]
            : field.type === 'number'
              ? 0
              : field.type === 'checkbox'
                ? false
                : '';
      }

      scoreData[field.id] = {
        label: field.label,
        value: value,
        type: field.type,
      };
    });

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
    } else {
      participantName = scoreData['team_name']?.value || '';
      matchId = scoreData['round']?.value || '';
    }

    // For DB-backed seeding: include event_id, team_id for correct storage
    const eventId = schema.eventId ?? null;
    const scoreDestination = schema.scoreDestination;
    const isDbBackedSeeding =
      scoreDestination === 'db' && eventId && !isHeadToHead;
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
      const winnerTeam = teamsData.find((t: any) => {
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

      if (!response.ok) throw new Error('Failed to submit score');

      // Cache the round number for next submission (seeding only, not queue-based)
      if (!isHeadToHead && !useQueueForSeeding && scoreData['round']?.value) {
        localStorage.setItem('lastRoundNumber', scoreData['round'].value);
      }

      // Show success notification
      showNotification('Score submitted successfully!', 'success');

      // Reset form
      if (isHeadToHead) {
        // For head-to-head, reset completely so user can select a new game
        setFormData({});
        // Reload bracket games in case some are now decided
        loadBracketGames();
      } else if (useQueueForSeeding) {
        // For queue-based seeding, reset and reload queue
        setFormData({});
        loadQueue();
      } else {
        // For manual seeding, keep round number for convenience
        const currentRound = formData['round'];
        setFormData({ round: currentRound });
      }
    } catch (error) {
      console.error('Error submitting score:', error);
      showNotification('Failed to submit score. Please try again.', 'error');
    }
  };

  const renderWinnerSelect = (field: any) => {
    const teamATotal = calculatedValues['team_a_total'] || 0;
    const teamBTotal = calculatedValues['team_b_total'] || 0;
    const teamAName = formData.team_a_name || 'Team A';
    const teamBName = formData.team_b_name || 'Team B';
    const teamANumber = formData.team_a_number || '';
    const teamBNumber = formData.team_b_number || '';
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

  const renderField = (field: any) => {
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
      const calcValue = calculatedValues[field.id] || 0;
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
        </div>
      );
    }

    const value =
      formData[field.id] !== undefined
        ? formData[field.id]
        : field.type === 'number'
          ? 0
          : '';

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
          value={value}
          onChange={(e) => handleInputChange(field.id, e.target.value, field)}
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
              const team1Display = game.team1?.displayName || 'Bye';
              const team2Display = game.team2?.displayName || 'Bye';
              return (
                <option key={game.gameNumber} value={game.gameNumber}>
                  Game {game.gameNumber}: {team1Display} vs {team2Display}
                </option>
              );
            })
          )}
        </select>
      );
    }

    return (
      <>
        {field.type === 'text' && (
          <input
            type="text"
            className="score-input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            required={field.required}
            disabled={field.autoPopulated}
          />
        )}
        {field.type === 'number' && (
          <input
            type="number"
            className="score-input"
            min={field.min ?? 0}
            max={field.max}
            step={field.step || 1}
            value={value}
            onChange={(e) => {
              let newValue = e.target.value;
              if (newValue === '' || !isNaN(Number(newValue))) {
                // Enforce min/max bounds
                const numValue = Number(newValue);
                if (
                  newValue !== '' &&
                  field.max !== undefined &&
                  numValue > field.max
                ) {
                  newValue = String(field.max);
                }
                if (
                  newValue !== '' &&
                  field.min !== undefined &&
                  numValue < field.min
                ) {
                  newValue = String(field.min);
                }
                handleInputChange(field.id, newValue);
              }
            }}
            onInput={(e) => {
              const input = e.target as HTMLInputElement;
              const cursorPosition = input.selectionStart;
              const cleaned = input.value.replace(/[^0-9.-]/g, '');
              if (input.value !== cleaned) {
                input.value = cleaned;
                if (cursorPosition) {
                  input.setSelectionRange(
                    cursorPosition - 1,
                    cursorPosition - 1,
                  );
                }
                e.preventDefault();
              }
            }}
            required={field.required}
          />
        )}
        {field.type === 'dropdown' && (
          <select
            className={`score-input ${isCompact ? 'compact' : ''}`}
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value, field)}
            required={field.required}
            style={{
              width: isCompact ? '70px' : '100%',
              textAlign: isCompact ? 'center' : 'left',
            }}
          >
            <option value="">Select...</option>
            {field.dataSource && dynamicData[field.id]
              ? dynamicData[field.id].map((item: any, idx: number) => (
                  <option key={idx} value={item[field.dataSource.valueField]}>
                    {item[field.dataSource.labelField]}
                  </option>
                ))
              : field.options
                ? field.options.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                : null}
          </select>
        )}
        {field.type === 'buttons' && (
          <div className="score-button-group">
            {field.options?.map((opt: any) => (
              <button
                key={opt.value}
                type="button"
                className={`score-option-button ${value === opt.value ? 'selected' : ''}`}
                onClick={() => handleInputChange(field.id, opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {field.type === 'checkbox' && (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleInputChange(field.id, e.target.checked)}
            required={field.required}
          />
        )}
      </>
    );
  };

  // Filter header fields - exclude auto-populated team fields in head-to-head mode
  // When using queue for seeding, exclude team_number, team_name, round (replaced by queue selector)
  const headerFields = schema.fields.filter((f: any) => {
    if (f.column) return false;
    if (
      f.type === 'section_header' ||
      f.type === 'group_header' ||
      f.type === 'calculated'
    )
      return false;
    if (f.type === 'winner-select') return false;
    if (
      useQueueForSeeding &&
      ['team_number', 'team_name', 'round'].includes(f.id)
    )
      return false;
    return true;
  });

  return (
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

      <form onSubmit={handleSubmit} className="scoresheet-form">
        {/* Title row with reset button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '1.5rem',
            paddingBottom: '1rem',
            borderBottom: '2px solid var(--border-color)',
          }}
        >
          {/* Invisible spacer to balance the reset button and keep title centered */}
          <div style={{ width: '60px' }}></div>

          {/* Centered title */}
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

          {/* Reset button */}
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

        {/* Winner selection for head-to-head mode */}
        {isHeadToHead &&
          schema.fields
            .filter((f: any) => f.type === 'winner-select')
            .map(renderField)}

        {/* Render grand total if it exists (no column specified) */}
        {schema.fields.filter((f: any) => f.isGrandTotal).map(renderField)}

        <div className="scoresheet-footer">
          <button type="submit" className="btn btn-primary btn-large">
            {isHeadToHead ? 'Submit Winner' : 'Submit Score'}
          </button>
        </div>
      </form>
    </>
  );
}
