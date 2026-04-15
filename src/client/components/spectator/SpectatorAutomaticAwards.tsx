import React from 'react';
import '../bracket/BracketDisplay.css';
import '../../pages/Spectator.css';

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface PublicAwardTeam {
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface MedalPlacement {
  place: 1 | 2 | 3;
  medal: MedalKind;
  recipients: PublicAwardTeam[];
}

export interface DeBracketAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface PerBracketOverallAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface EventOverallAwards {
  placements: MedalPlacement[];
}

export interface AutomaticAwardsPublic {
  de: DeBracketAwards[];
  perBracketOverall: PerBracketOverallAwards[];
  eventOverall: EventOverallAwards | null;
}

function placeLabel(place: 1 | 2 | 3): string {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  return '3rd';
}

/** Avoid "#113 #113 113 Name" when the list row already shows the team number in bold. */
function stripRedundantLeadingTeamNumber(
  teamNumber: number,
  label: string,
): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  const withoutDup = trimmed
    .replace(new RegExp(`^#?\\s*${teamNumber}\\s+`), '')
    .trim();
  return withoutDup || trimmed;
}

function formatTeamLine(t: PublicAwardTeam): string {
  const raw = t.display_name?.trim() ? t.display_name : t.team_name;
  return stripRedundantLeadingTeamNumber(t.team_number, raw);
}

function MedalTable({ placements }: { placements: MedalPlacement[] }) {
  return (
    <table className="ranking-table spectator-awards-medal-table">
      <tbody>
        {placements.map((p) => (
          <tr
            key={`${p.place}-${p.medal}`}
            className={`ranking-row-${p.medal}`}
          >
            <td className="ranking-place spectator-awards-place">
              <strong>{placeLabel(p.place)}</strong>
            </td>
            <td className="spectator-awards-recipients-cell">
              <ul className="spectator-awards-recipients">
                {p.recipients.map((r, i) => (
                  <li
                    key={`${r.team_number}-${i}`}
                    className="spectator-awards-recipient"
                  >
                    <strong>#{r.team_number}</strong>{' '}
                    <span className="spectator-awards-recipient-name">
                      {formatTeamLine(r)}
                    </span>
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function hasAutomaticAwardsContent(
  auto: AutomaticAwardsPublic | null | undefined,
): boolean {
  if (!auto) return false;
  return (
    (auto.de?.length ?? 0) > 0 ||
    (auto.perBracketOverall?.length ?? 0) > 0 ||
    (auto.eventOverall?.placements?.length ?? 0) > 0
  );
}

interface Props {
  automatic: AutomaticAwardsPublic;
}

export default function SpectatorAutomaticAwards({ automatic }: Props) {
  return (
    <div className="spectator-automatic-awards">
      {automatic.de.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h4
            className="spectator-awards-section-title"
            style={{
              margin: '0 0 0.75rem',
              fontSize: '1.05rem',
            }}
          >
            Double elimination
          </h4>
          <p
            className="spectator-awards-section-description"
            style={{
              color: 'var(--secondary-color)',
              fontSize: '0.9rem',
              margin: '0 0 0.75rem',
            }}
          >
            Placement in the bracket (1st / 2nd / 3rd) from completed DE
            rankings.
          </p>
          {automatic.de.map((b) => (
            <div key={b.bracket_id} style={{ marginBottom: '1.25rem' }}>
              <h5
                className="spectator-awards-bracket-title"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                {b.bracket_name}
              </h5>
              <MedalTable placements={b.placements} />
            </div>
          ))}
        </section>
      )}

      {automatic.perBracketOverall.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h4
            className="spectator-awards-section-title"
            style={{
              margin: '0 0 0.75rem',
              fontSize: '1.05rem',
            }}
          >
            Per-bracket overall
          </h4>
          <p
            className="spectator-awards-section-description"
            style={{
              color: 'var(--secondary-color)',
              fontSize: '0.9rem',
              margin: '0 0 0.75rem',
            }}
          >
            Top teams by documentation + seeding + weighted DE score within each
            bracket.
          </p>
          {automatic.perBracketOverall.map((b) => (
            <div key={b.bracket_id} style={{ marginBottom: '1.25rem' }}>
              <h5
                className="spectator-awards-bracket-title"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                {b.bracket_name}
              </h5>
              <MedalTable placements={b.placements} />
            </div>
          ))}
        </section>
      )}

      {automatic.eventOverall &&
        automatic.eventOverall.placements.length > 0 && (
          <section style={{ marginBottom: '1.5rem' }}>
            <h4
              className="spectator-awards-section-title"
              style={{
                margin: '0 0 0.75rem',
                fontSize: '1.05rem',
              }}
            >
              Event overall
            </h4>
            <p
              className="spectator-awards-section-description"
              style={{
                color: 'var(--secondary-color)',
                fontSize: '0.9rem',
                margin: '0 0 0.75rem',
              }}
            >
              Top teams by total score across documentation, seeding, and all
              bracket DE contributions.
            </p>
            <MedalTable placements={automatic.eventOverall.placements} />
          </section>
        )}
    </div>
  );
}
