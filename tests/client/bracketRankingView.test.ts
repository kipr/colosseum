import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BracketRankingView from '../../src/client/components/bracket/BracketRankingView';

describe('BracketRankingView', () => {
  it('shows double seeding in the ranking table', () => {
    const html = renderToStaticMarkup(
      React.createElement(BracketRankingView, {
        bracketId: 1,
        weight: 1,
        loading: false,
        rankings: [
          {
            id: 1,
            bracket_id: 1,
            team_id: 1,
            seed_position: 1,
            initial_slot: 1,
            is_bye: false,
            team_number: 101,
            team_name: 'Alpha',
            final_rank: 1,
            bracket_raw_score: 1,
            weighted_bracket_raw_score: 1,
            doc_score: 0.8,
            raw_seed_score: 0.7,
            raw_double_seed_score: 0.6,
            total: 3.1,
          },
        ],
      }),
    );

    expect(html).toContain('Raw Double Seeding');
    expect(html).toContain('0.6000');
  });

  it('sorts by place by default, ties by id, unranked last by id', () => {
    const entry = {
      bracket_id: 1,
      seed_position: 1,
      initial_slot: 1,
      is_bye: false,
      bracket_raw_score: 1,
      weighted_bracket_raw_score: 1,
      doc_score: 0.8,
      raw_seed_score: 0.7,
      raw_double_seed_score: 0.6,
      total: 3.1,
    };
    const html = renderToStaticMarkup(
      React.createElement(BracketRankingView, {
        bracketId: 1,
        weight: 1,
        loading: false,
        rankings: [
          {
            ...entry,
            id: 6,
            team_id: 6,
            team_number: 106,
            team_name: 'Foxtrot',
            final_rank: null,
          },
          {
            ...entry,
            id: 5,
            team_id: 5,
            team_number: 105,
            team_name: 'Echo',
            final_rank: null,
          },
          {
            ...entry,
            id: 3,
            team_id: 3,
            team_number: 103,
            team_name: 'Charlie',
            final_rank: 2,
          },
          {
            ...entry,
            id: 2,
            team_id: 2,
            team_number: 102,
            team_name: 'Bravo',
            final_rank: 2,
          },
          {
            ...entry,
            id: 1,
            team_id: 1,
            team_number: 101,
            team_name: 'Alpha',
            final_rank: 1,
          },
        ],
      }),
    );

    const order = ['Alpha', 'Bravo', 'Charlie', 'Echo', 'Foxtrot'].map((name) =>
      html.indexOf(name),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
