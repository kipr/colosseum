import React from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import {
  hasAutomaticAwardsContent,
  ordinalLabel,
  type AutomaticAwardsPublic,
  type MedalPlacement,
  type PublicAwardTeam,
} from '@shared/automaticAwards';
import '../seeding/SeedingTables.css';
import '../../pages/Spectator.css';

export type {
  AutomaticAwardsPublic,
  MedalPlacement,
  PublicAwardTeam,
} from '@shared/automaticAwards';
export { hasAutomaticAwardsContent };

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

const medalColumns: UnifiedColumnDef<MedalPlacement>[] = [
  {
    kind: 'data',
    id: 'place',
    header: { full: 'Place' },
    headerClassName: 'rank-cell spectator-awards-place',
    cellClassName: 'rank-cell spectator-awards-place',
    renderCell: (p) => <strong>{ordinalLabel(p.place)}</strong>,
  },
  {
    kind: 'data',
    id: 'recipients',
    header: { full: 'Recipients' },
    cellClassName: 'spectator-awards-recipients-cell',
    renderCell: (p) => (
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
    ),
  },
];

function MedalTable({ placements }: { placements: MedalPlacement[] }) {
  return (
    <UnifiedTable
      showHeader={false}
      columns={medalColumns}
      rows={placements}
      getRowKey={(p) => `${p.place}-${p.medal ?? 'none'}`}
      rowClassName={(p) => (p.medal ? `ranking-row-${p.medal}` : undefined)}
      tableClassName="seeding-table spectator-awards-medal-table"
    />
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
            Placement in the bracket from completed DE rankings.
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

      {automatic.seeding && automatic.seeding.placements.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h4
            className="spectator-awards-section-title"
            style={{
              margin: '0 0 0.75rem',
              fontSize: '1.05rem',
            }}
          >
            Seeding
          </h4>
          <p
            className="spectator-awards-section-description"
            style={{
              color: 'var(--secondary-color)',
              fontSize: '0.9rem',
              margin: '0 0 0.75rem',
            }}
          >
            Top teams by standalone seeding rank.
          </p>
          <MedalTable placements={automatic.seeding.placements} />
        </section>
      )}
    </div>
  );
}
