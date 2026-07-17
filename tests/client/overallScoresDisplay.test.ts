import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OverallScoresDisplay, {
  type OverallRow,
} from '../../src/client/components/overall/OverallScoresDisplay';

const rows: OverallRow[] = [
  {
    team_id: 1,
    team_number: 101,
    team_name: 'Alpha',
    doc_score: 0.8,
    raw_seed_score: 0.7,
    raw_double_seed_score: 0.6,
    weighted_de_score: 0.5,
    total: 2.6,
  },
];

describe('OverallScoresDisplay', () => {
  it('hides double seeding when the event has no double seeding', () => {
    const html = renderToStaticMarkup(
      React.createElement(OverallScoresDisplay, { rows }),
    );

    expect(html).not.toContain('Raw Double Seeding');
    expect(html).not.toContain('2x Seed');
    expect(html).toContain('Raw Seeding');
    expect(html).toContain('Weighted DE');
  });

  it('shows double seeding when the event has double seeding', () => {
    const html = renderToStaticMarkup(
      React.createElement(OverallScoresDisplay, {
        rows,
        showDoubleSeeding: true,
      }),
    );

    expect(html).toContain('Raw Double Seeding');
    expect(html).toContain('2x Seed');
  });
});
