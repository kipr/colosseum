import {
  TEAM_INITIALS_FORMAT_HINT,
  TEAM_INITIALS_MAX_LENGTH,
  type TeamInitialsSide,
} from '../../shared/teamInitials';

export interface TeamInitialsParticipant {
  side: TeamInitialsSide;
  label: string;
}

interface TeamInitialsPanelProps {
  participants: TeamInitialsParticipant[];
  values: Partial<Record<TeamInitialsSide, string>>;
  /** What the teams are signing off on, e.g. "Winner: 123 · 45–30". */
  summary: string;
  /** Shown after a change to the sheet cleared initials already given. */
  staleMessage: string | null;
  onChange: (side: TeamInitialsSide, value: string) => void;
  onBlur: (side: TeamInitialsSide) => void;
}

export function teamInitialsInputId(side: TeamInitialsSide): string {
  return `team-initials-${side}`;
}

export default function TeamInitialsPanel({
  participants,
  values,
  summary,
  staleMessage,
  onChange,
  onBlur,
}: TeamInitialsPanelProps) {
  return (
    <div className="team-initials-container">
      <h3 className="winner-select-title">Team Initials</h3>
      <p className="team-initials-help">
        Have each team review the sheet and initial below.
      </p>
      {summary && <p className="team-initials-summary">{summary}</p>}
      {staleMessage && (
        <p className="team-initials-stale" role="alert">
          {staleMessage}
        </p>
      )}
      <div className="team-initials-inputs">
        {participants.map(({ side, label }) => (
          <label
            key={side}
            className="team-initials-label"
            htmlFor={teamInitialsInputId(side)}
          >
            {label}
            <input
              id={teamInitialsInputId(side)}
              type="text"
              className="score-input team-initials-input"
              value={values[side] ?? ''}
              onChange={(event) => onChange(side, event.target.value)}
              onBlur={() => onBlur(side)}
              placeholder={TEAM_INITIALS_FORMAT_HINT}
              // Leave room for the periods and spaces normalization strips.
              maxLength={TEAM_INITIALS_MAX_LENGTH * 3}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
        ))}
      </div>
    </div>
  );
}
