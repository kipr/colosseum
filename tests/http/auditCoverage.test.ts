/**
 * Audit coverage: every mutating route writes exactly one audit_log entry
 * attributed to the acting admin, and no mutating route is left unlisted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Router } from 'express';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import {
  __setTestDatabaseAdapter,
  Database,
} from '../../src/server/database/connection';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  jsonRequest,
} from './helpers/testServer';
import {
  seedAwardTemplate,
  seedBracket,
  seedBracketEntry,
  seedBracketGame,
  seedChatMessage,
  seedDocumentationScore,
  seedDocumentationScoreCategory,
  seedDoubleSeedingMatch,
  seedEvent,
  seedEventAward,
  seedEventAwardIndividualRecipient,
  seedEventAwardRecipient,
  seedFieldTemplate,
  seedQueueItem,
  seedScoreSubmission,
  seedScoresheetTemplate,
  seedSeedingScore,
  seedTeam,
  seedUser,
} from './helpers/seed';
import adminRoutes from '../../src/server/routes/admin';
import apiRoutes from '../../src/server/routes/api';
import auditRoutes from '../../src/server/routes/audit';
import authRoutes from '../../src/server/routes/auth';
import awardsRoutes from '../../src/server/routes/awards';
import bracketsRoutes from '../../src/server/routes/brackets';
import chatRoutes from '../../src/server/routes/chat';
import documentationScoresRoutes from '../../src/server/routes/documentationScores';
import doubleSeedingRoutes from '../../src/server/routes/doubleSeeding';
import eventsRoutes from '../../src/server/routes/events';
import fieldTemplatesRoutes from '../../src/server/routes/fieldTemplates';
import queueRoutes from '../../src/server/routes/queue';
import scoresRoutes from '../../src/server/routes/scores';
import scoresheetRoutes from '../../src/server/routes/scoresheet';
import seedingRoutes from '../../src/server/routes/seeding';
import teamsRoutes from '../../src/server/routes/teams';

// Mount paths mirror src/server/server.ts.
const MOUNTS: [string, Router][] = [
  ['/auth', authRoutes],
  ['/api/admin', adminRoutes],
  ['/scoresheet', scoresheetRoutes],
  ['/field-templates', fieldTemplatesRoutes],
  ['/api', apiRoutes],
  ['/scores', scoresRoutes],
  ['/chat', chatRoutes],
  ['/events', eventsRoutes],
  ['/teams', teamsRoutes],
  ['/seeding', seedingRoutes],
  ['/double-seeding', doubleSeedingRoutes],
  ['/brackets', bracketsRoutes],
  ['/queue', queueRoutes],
  ['/audit', auditRoutes],
  ['/documentation-scores', documentationScoresRoutes],
  ['/awards', awardsRoutes],
];

/** Mutating routes that intentionally write no audit entry. */
const EXEMPT: Record<string, string> = {
  'POST /audit': 'writes the audit entry itself',
  'POST /scoresheet/templates/:id/verify':
    'judge sign-in; mints a session and changes no rows',
  'POST /chat/events/:eventId/messages':
    'chat messages are already their own durable record',
};

/** Audited routes whose audit rows are asserted by dedicated test files. */
const COVERED_ELSEWHERE: Record<string, string> = {
  'POST /api/scores/submit': 'apiScoresSubmit.test.ts',
  'POST /scores/event/:eventId/accept/bulk': 'scoresEventScoped.test.ts',
  'POST /scores/:id/accept-event': 'scoresEventScoped.test.ts',
  'POST /scores/:id/revert-event': 'scoresEventScoped.test.ts',
  'POST /scores/:id/reject': 'scores.revert.test.ts',
  'PUT /scores/:id': 'scores.crud.test.ts',
  'DELETE /scores/:id': 'scores.crud.test.ts',
};

interface ExpectedAudit {
  action: string;
  entity_type: string;
  entity_id?: number | null;
  event_id?: number | null;
}

interface Arranged {
  path: string;
  body?: unknown;
  expect: ExpectedAudit;
}

interface AuditCase {
  /** "METHOD /mount/route-pattern", matched against the routers' tables. */
  route: string;
  /** Distinguishes several cases for one route (e.g. separate code paths). */
  variant?: string;
  arrange: (db: Database) => Promise<Arranged>;
}

async function eventWithTeams(db: Database, count = 2) {
  const event = await seedEvent(db);
  const teams = [];
  for (let n = 1; n <= count; n++) {
    teams.push(
      await seedTeam(db, {
        event_id: event.id,
        team_number: n,
        team_name: `Team ${n}`,
      }),
    );
  }
  return { event, teams };
}

async function bracketWithGame(db: Database) {
  const { event, teams } = await eventWithTeams(db);
  const bracket = await seedBracket(db, {
    event_id: event.id,
    bracket_size: 4,
  });
  const game = await seedBracketGame(db, {
    bracket_id: bracket.id,
    game_number: 1,
    team1_id: teams[0].id,
    team2_id: teams[1].id,
    status: 'ready',
  });
  return { event, teams, bracket, game };
}

async function eventAward(db: Database) {
  const { event, teams } = await eventWithTeams(db, 1);
  const award = await seedEventAward(db, { event_id: event.id });
  return { event, team: teams[0], award };
}

const CASES: AuditCase[] = [
  // ── Events ──
  {
    route: 'POST /events',
    arrange: async () => ({
      path: '/events',
      body: { name: 'Audited Event' },
      expect: { action: 'event_created', entity_type: 'event' },
    }),
  },
  {
    route: 'PATCH /events/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: `/events/${event.id}`,
        body: { name: 'Renamed' },
        expect: {
          action: 'event_updated',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /events/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: `/events/${event.id}`,
        // audit_log.event_id references events, so the row cannot point at
        // the deleted event; it stays reachable by entity.
        expect: {
          action: 'event_deleted',
          entity_type: 'event',
          entity_id: event.id,
          event_id: null,
        },
      };
    },
  },

  // ── Teams ──
  {
    route: 'POST /teams',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: '/teams',
        body: { event_id: event.id, team_number: 7, team_name: 'New' },
        expect: {
          action: 'team_added',
          entity_type: 'team',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /teams/bulk',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: '/teams/bulk',
        body: {
          event_id: event.id,
          teams: [{ team_number: 1, team_name: 'One' }],
        },
        expect: {
          action: 'teams_bulk_added',
          entity_type: 'teams',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /teams/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      return {
        path: `/teams/${teams[0].id}`,
        body: { team_name: 'Renamed' },
        expect: {
          action: 'team_updated',
          entity_type: 'team',
          entity_id: teams[0].id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /teams/:id/check-in',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      return {
        path: `/teams/${teams[0].id}/check-in`,
        expect: {
          action: 'team_checked_in',
          entity_type: 'team',
          entity_id: teams[0].id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /teams/event/:eventId/check-in/bulk',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db, 2);
      return {
        path: `/teams/event/${event.id}/check-in/bulk`,
        body: { team_numbers: [1, 2] },
        expect: {
          action: 'teams_bulk_checked_in',
          entity_type: 'teams',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /teams/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      return {
        path: `/teams/${teams[0].id}`,
        expect: {
          action: 'team_deleted',
          entity_type: 'team',
          entity_id: teams[0].id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Seeding ──
  {
    route: 'POST /seeding/scores',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      return {
        path: '/seeding/scores',
        body: { team_id: teams[0].id, round_number: 1, score: 10 },
        expect: {
          action: 'seeding_score_submitted',
          entity_type: 'seeding_score',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /seeding/scores/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const score = await seedSeedingScore(db, {
        team_id: teams[0].id,
        round_number: 1,
        score: 10,
      });
      return {
        path: `/seeding/scores/${score.id}`,
        body: { score: 20 },
        expect: {
          action: 'seeding_score_updated',
          entity_type: 'seeding_score',
          entity_id: score.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /seeding/scores/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const score = await seedSeedingScore(db, {
        team_id: teams[0].id,
        round_number: 1,
        score: 10,
      });
      return {
        path: `/seeding/scores/${score.id}`,
        expect: {
          action: 'seeding_score_deleted',
          entity_type: 'seeding_score',
          entity_id: score.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /seeding/rankings/recalculate/:eventId',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: `/seeding/rankings/recalculate/${event.id}`,
        expect: {
          action: 'seeding_rankings_recalculated',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Double seeding ──
  {
    route: 'POST /double-seeding/matches/generate/:eventId',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: `/double-seeding/matches/generate/${event.id}`,
        body: { rounds: 1 },
        expect: {
          action: 'double_seeding_matches_generated',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /double-seeding/matches/generate/:eventId',
    variant: 'disable',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: `/double-seeding/matches/generate/${event.id}`,
        body: { rounds: 0 },
        expect: {
          action: 'double_seeding_disabled',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /double-seeding/matches/event/:eventId',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db);
      await seedDoubleSeedingMatch(db, {
        event_id: event.id,
        round_number: 1,
        team1_id: teams[0].id,
        team2_id: teams[1].id,
      });
      return {
        path: `/double-seeding/matches/event/${event.id}`,
        expect: {
          action: 'double_seeding_matches_deleted',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /double-seeding/matches/event/:eventId/round/:roundNumber',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db);
      await seedDoubleSeedingMatch(db, {
        event_id: event.id,
        round_number: 1,
        team1_id: teams[0].id,
        team2_id: teams[1].id,
      });
      return {
        path: `/double-seeding/matches/event/${event.id}/round/1`,
        expect: {
          action: 'double_seeding_round_deleted',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /double-seeding/rankings/recalculate/:eventId',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: `/double-seeding/rankings/recalculate/${event.id}`,
        expect: {
          action: 'double_seeding_rankings_recalculated',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Scores ──
  {
    route: 'POST /scores/:id/revert',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const template = await seedScoresheetTemplate(db);
      const score = await seedScoreSubmission(db, {
        template_id: template.id,
        event_id: event.id,
        score_data: '{}',
        status: 'rejected',
      });
      return {
        path: `/scores/${score.id}/revert`,
        expect: {
          action: 'score_reverted',
          entity_type: 'score_submission',
          entity_id: score.id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Queue ──
  {
    route: 'POST /queue',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      return {
        path: '/queue',
        body: {
          event_id: event.id,
          queue_type: 'seeding',
          seeding_team_id: teams[0].id,
          seeding_round: 1,
        },
        expect: {
          action: 'queue_item_added',
          entity_type: 'game_queue',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /queue/populate-from-bracket',
    arrange: async (db) => {
      const { event } = await bracketWithGame(db);
      return {
        path: '/queue/populate-from-bracket',
        body: { event_id: event.id },
        expect: {
          action: 'queue_populated_from_bracket',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /queue/populate-from-seeding',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: '/queue/populate-from-seeding',
        body: { event_id: event.id },
        expect: {
          action: 'queue_populated_from_seeding',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /queue/:id/presence',
    arrange: async (db) => {
      const { event, teams, game } = await bracketWithGame(db);
      const item = await seedQueueItem(db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'called',
      });
      return {
        path: `/queue/${item.id}/presence`,
        body: { team_id: teams[0].id, present: true },
        expect: {
          action: 'queue_presence_updated',
          entity_type: 'game_queue',
          entity_id: item.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /queue/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const item = await seedQueueItem(db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: teams[0].id,
        seeding_round: 1,
      });
      return {
        path: `/queue/${item.id}`,
        body: { table_number: 2 },
        expect: {
          action: 'queue_item_updated',
          entity_type: 'game_queue',
          entity_id: item.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /queue/:id/call',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const item = await seedQueueItem(db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: teams[0].id,
        seeding_round: 1,
      });
      return {
        path: `/queue/${item.id}/call`,
        body: { table_number: 1 },
        expect: {
          action: 'queue_item_called',
          entity_type: 'game_queue',
          entity_id: item.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /queue/:id',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const item = await seedQueueItem(db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: teams[0].id,
        seeding_round: 1,
      });
      return {
        path: `/queue/${item.id}`,
        expect: {
          action: 'queue_item_removed',
          entity_type: 'game_queue',
          entity_id: item.id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Brackets ──
  {
    route: 'POST /brackets',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: '/brackets',
        body: { event_id: event.id, name: 'Main', bracket_size: 4 },
        expect: {
          action: 'bracket_created',
          entity_type: 'bracket',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets',
    variant: 'from team selection',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 4);
      return {
        path: '/brackets',
        body: {
          event_id: event.id,
          name: 'Main',
          team_ids: teams.map((t) => t.id),
        },
        expect: {
          action: 'bracket_created',
          entity_type: 'bracket',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /brackets/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const bracket = await seedBracket(db, { event_id: event.id });
      return {
        path: `/brackets/${bracket.id}`,
        body: { name: 'Renamed' },
        expect: {
          action: 'bracket_updated',
          entity_type: 'bracket',
          entity_id: bracket.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /brackets/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const bracket = await seedBracket(db, { event_id: event.id });
      return {
        path: `/brackets/${bracket.id}`,
        expect: {
          action: 'bracket_deleted',
          entity_type: 'bracket',
          entity_id: bracket.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/rankings/calculate',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db);
      const bracket = await seedBracket(db, { event_id: event.id });
      await seedBracketEntry(db, {
        bracket_id: bracket.id,
        seed_position: 1,
        team_id: teams[0].id,
      });
      await seedBracketEntry(db, {
        bracket_id: bracket.id,
        seed_position: 2,
        team_id: teams[1].id,
      });
      const final = await seedBracketGame(db, {
        bracket_id: bracket.id,
        game_number: 1,
        bracket_side: 'finals',
        team1_id: teams[0].id,
        team2_id: teams[1].id,
        status: 'completed',
      });
      await db.run(
        'UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE id = ?',
        [teams[0].id, teams[1].id, final.id],
      );
      return {
        path: `/brackets/${bracket.id}/rankings/calculate`,
        expect: {
          action: 'bracket_rankings_calculated',
          entity_type: 'bracket',
          entity_id: bracket.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/entries',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const bracket = await seedBracket(db, { event_id: event.id });
      return {
        path: `/brackets/${bracket.id}/entries`,
        body: { team_id: teams[0].id, seed_position: 1 },
        expect: {
          action: 'bracket_entry_added',
          entity_type: 'bracket_entry',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /brackets/:bracketId/entries/:entryId',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const bracket = await seedBracket(db, { event_id: event.id });
      const entry = await seedBracketEntry(db, {
        bracket_id: bracket.id,
        seed_position: 1,
        team_id: teams[0].id,
      });
      return {
        path: `/brackets/${bracket.id}/entries/${entry.id}`,
        expect: {
          action: 'bracket_entry_removed',
          entity_type: 'bracket_entry',
          entity_id: entry.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/entries/generate',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db);
      for (const team of teams) {
        await seedSeedingScore(db, {
          team_id: team.id,
          round_number: 1,
          score: 10,
        });
      }
      const bracket = await seedBracket(db, {
        event_id: event.id,
        bracket_size: 4,
      });
      return {
        path: `/brackets/${bracket.id}/entries/generate`,
        expect: {
          action: 'bracket_entries_generated',
          entity_type: 'bracket',
          entity_id: bracket.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/games',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const bracket = await seedBracket(db, { event_id: event.id });
      return {
        path: `/brackets/${bracket.id}/games`,
        body: { game_number: 1 },
        expect: {
          action: 'bracket_game_created',
          entity_type: 'bracket_game',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /brackets/games/:id',
    arrange: async (db) => {
      const { event, game } = await bracketWithGame(db);
      return {
        path: `/brackets/games/${game.id}`,
        body: { team1_score: 5 },
        expect: {
          action: 'bracket_game_updated',
          entity_type: 'bracket_game',
          entity_id: game.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/games/:id/advance',
    arrange: async (db) => {
      const { event, teams, game } = await bracketWithGame(db);
      await db.run(
        'UPDATE bracket_games SET winner_id = ?, loser_id = ? WHERE id = ?',
        [teams[0].id, teams[1].id, game.id],
      );
      return {
        path: `/brackets/games/${game.id}/advance`,
        expect: {
          action: 'bracket_winner_advanced',
          entity_type: 'bracket_game',
          entity_id: game.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/games/generate',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const bracket = await seedBracket(db, {
        event_id: event.id,
        bracket_size: 4,
      });
      return {
        path: `/brackets/${bracket.id}/games/generate`,
        expect: {
          action: 'bracket_games_generated',
          entity_type: 'bracket',
          entity_id: bracket.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/:id/advance-winner',
    arrange: async (db) => {
      const { event, teams, bracket, game } = await bracketWithGame(db);
      return {
        path: `/brackets/${bracket.id}/advance-winner`,
        body: { game_id: game.id, winner_id: teams[0].id },
        expect: {
          action: 'bracket_winner_advanced',
          entity_type: 'bracket_game',
          entity_id: game.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /brackets/templates',
    arrange: async () => ({
      path: '/brackets/templates',
      body: {
        bracket_size: 4,
        game_number: 999,
        round_name: 'Audit Round',
        round_number: 1,
        bracket_side: 'winners',
        team1_source: 'seed:1',
        team2_source: 'seed:2',
      },
      expect: {
        action: 'bracket_template_created',
        entity_type: 'bracket_template',
        event_id: null,
      },
    }),
  },

  // ── Judge chat ──
  {
    route: 'DELETE /chat/events/:eventId/conversations/:conversationKey',
    arrange: async (db) => {
      const event = await seedEvent(db);
      await seedChatMessage(db, {
        event_id: event.id,
        conversation_key: 'conv-1',
      });
      return {
        path: `/chat/events/${event.id}/conversations/conv-1`,
        expect: {
          action: 'chat_conversation_deleted',
          entity_type: 'chat_conversation',
          entity_id: null,
          event_id: event.id,
        },
      };
    },
  },

  // ── Documentation scores ──
  {
    route: 'POST /documentation-scores/categories',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: '/documentation-scores/categories',
        body: { event_id: event.id, ordinal: 1, name: 'Doc', max_score: 10 },
        expect: {
          action: 'documentation_category_created',
          entity_type: 'documentation_category',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /documentation-scores/categories/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const category = await seedDocumentationScoreCategory(db, {
        event_id: event.id,
        ordinal: 1,
        max_score: 10,
      });
      return {
        path: `/documentation-scores/categories/${category.id}?event_id=${event.id}`,
        body: { ordinal: 2 },
        expect: {
          action: 'documentation_category_updated',
          entity_type: 'documentation_category',
          entity_id: category.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /documentation-scores/categories/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const category = await seedDocumentationScoreCategory(db, {
        event_id: event.id,
        ordinal: 1,
        max_score: 10,
      });
      return {
        path: `/documentation-scores/categories/${category.id}?event_id=${event.id}`,
        expect: {
          action: 'documentation_category_deleted',
          entity_type: 'documentation_category',
          entity_id: category.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PUT /documentation-scores/event/:eventId/team/:teamId',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const category = await seedDocumentationScoreCategory(db, {
        event_id: event.id,
        ordinal: 1,
        max_score: 10,
      });
      return {
        path: `/documentation-scores/event/${event.id}/team/${teams[0].id}`,
        body: { sub_scores: [{ category_id: category.id, score: 5 }] },
        expect: {
          action: 'documentation_score_saved',
          entity_type: 'documentation_score',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /documentation-scores/event/:eventId/team/:teamId',
    arrange: async (db) => {
      const { event, teams } = await eventWithTeams(db, 1);
      const score = await seedDocumentationScore(db, {
        event_id: event.id,
        team_id: teams[0].id,
        overall_score: 3,
      });
      return {
        path: `/documentation-scores/event/${event.id}/team/${teams[0].id}`,
        expect: {
          action: 'documentation_score_deleted',
          entity_type: 'documentation_score',
          entity_id: score.id,
          event_id: event.id,
        },
      };
    },
  },

  // ── Field templates ──
  {
    route: 'POST /field-templates',
    arrange: async () => ({
      path: '/field-templates',
      body: { name: 'Fields', fields: [] },
      expect: {
        action: 'field_template_created',
        entity_type: 'field_template',
        event_id: null,
      },
    }),
  },
  {
    route: 'PUT /field-templates/:id',
    arrange: async (db) => {
      const template = await seedFieldTemplate(db);
      return {
        path: `/field-templates/${template.id}`,
        body: { name: 'Renamed', fields: [] },
        expect: {
          action: 'field_template_updated',
          entity_type: 'field_template',
          entity_id: template.id,
          event_id: null,
        },
      };
    },
  },
  {
    route: 'DELETE /field-templates/:id',
    arrange: async (db) => {
      const template = await seedFieldTemplate(db);
      return {
        path: `/field-templates/${template.id}`,
        expect: {
          action: 'field_template_deleted',
          entity_type: 'field_template',
          entity_id: template.id,
          event_id: null,
        },
      };
    },
  },

  // ── Scoresheet templates ──
  {
    route: 'POST /scoresheet/templates',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: '/scoresheet/templates',
        body: {
          name: 'Sheet',
          schema: { fields: [] },
          accessCode: 'code',
          eventId: event.id,
        },
        expect: {
          action: 'scoresheet_template_created',
          entity_type: 'scoresheet_template',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PUT /scoresheet/templates/:id',
    arrange: async (db) => {
      const event = await seedEvent(db);
      const template = await seedScoresheetTemplate(db);
      return {
        path: `/scoresheet/templates/${template.id}`,
        body: {
          name: 'Renamed',
          schema: { fields: [] },
          accessCode: 'code',
          eventId: event.id,
        },
        expect: {
          action: 'scoresheet_template_updated',
          entity_type: 'scoresheet_template',
          entity_id: template.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /scoresheet/templates/:id',
    arrange: async (db) => {
      const template = await seedScoresheetTemplate(db);
      return {
        path: `/scoresheet/templates/${template.id}`,
        expect: {
          action: 'scoresheet_template_deleted',
          entity_type: 'scoresheet_template',
          entity_id: template.id,
          event_id: null,
        },
      };
    },
  },

  // ── Awards ──
  {
    route: 'POST /awards/templates',
    arrange: async () => ({
      path: '/awards/templates',
      body: { name: 'Judges Award' },
      expect: {
        action: 'award_template_created',
        entity_type: 'award_template',
        event_id: null,
      },
    }),
  },
  {
    route: 'PATCH /awards/templates/:id',
    arrange: async (db) => {
      const template = await seedAwardTemplate(db);
      return {
        path: `/awards/templates/${template.id}`,
        body: { name: 'Renamed' },
        expect: {
          action: 'award_template_updated',
          entity_type: 'award_template',
          entity_id: template.id,
          event_id: null,
        },
      };
    },
  },
  {
    route: 'DELETE /awards/templates/:id',
    arrange: async (db) => {
      const template = await seedAwardTemplate(db);
      return {
        path: `/awards/templates/${template.id}`,
        expect: {
          action: 'award_template_deleted',
          entity_type: 'award_template',
          entity_id: template.id,
          event_id: null,
        },
      };
    },
  },
  {
    route: 'POST /awards/event/:eventId/automatic',
    arrange: async (db) => {
      const { event } = await eventWithTeams(db);
      return {
        path: `/awards/event/${event.id}/automatic`,
        body: {
          de_top_n: 0,
          per_bracket_overall_top_n: 0,
          seeding_top_n: 0,
          acknowledge_warnings: true,
        },
        expect: {
          action: 'automatic_awards_applied',
          entity_type: 'event',
          entity_id: event.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /awards/event/:eventId',
    arrange: async (db) => {
      const event = await seedEvent(db);
      return {
        path: `/awards/event/${event.id}`,
        body: { name: 'Spirit Award' },
        expect: {
          action: 'event_award_created',
          entity_type: 'event_award',
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'PATCH /awards/event-awards/:id',
    arrange: async (db) => {
      const { event, award } = await eventAward(db);
      return {
        path: `/awards/event-awards/${award.id}`,
        body: { name: 'Renamed' },
        expect: {
          action: 'event_award_updated',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /awards/event-awards/:id',
    arrange: async (db) => {
      const { event, award } = await eventAward(db);
      return {
        path: `/awards/event-awards/${award.id}`,
        expect: {
          action: 'event_award_deleted',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /awards/event-awards/:id/recipients',
    arrange: async (db) => {
      const { event, team, award } = await eventAward(db);
      return {
        path: `/awards/event-awards/${award.id}/recipients`,
        body: { team_id: team.id },
        expect: {
          action: 'award_recipients_added',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'DELETE /awards/event-awards/:awardId/recipients/:teamId',
    arrange: async (db) => {
      const { event, team, award } = await eventAward(db);
      await seedEventAwardRecipient(db, {
        event_award_id: award.id,
        team_id: team.id,
      });
      return {
        path: `/awards/event-awards/${award.id}/recipients/${team.id}`,
        expect: {
          action: 'award_recipient_removed',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route: 'POST /awards/event-awards/:id/individual-recipients',
    arrange: async (db) => {
      const { event, award } = await eventAward(db);
      return {
        path: `/awards/event-awards/${award.id}/individual-recipients`,
        body: { name: 'Ada Lovelace' },
        expect: {
          action: 'award_individual_recipient_added',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
  {
    route:
      'DELETE /awards/event-awards/:awardId/individual-recipients/:recipientId',
    arrange: async (db) => {
      const { event, award } = await eventAward(db);
      const recipient = await seedEventAwardIndividualRecipient(db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
      });
      return {
        path: `/awards/event-awards/${award.id}/individual-recipients/${recipient.id}`,
        expect: {
          action: 'award_individual_recipient_removed',
          entity_type: 'event_award',
          entity_id: award.id,
          event_id: event.id,
        },
      };
    },
  },
];

/** Every POST/PUT/PATCH/DELETE route registered on the mounted routers. */
function mutatingRoutes(): string[] {
  const routes: string[] = [];
  for (const [mount, router] of MOUNTS) {
    for (const layer of router.stack) {
      const route = layer.route as
        | { path: string; methods: Record<string, boolean> }
        | undefined;
      if (!route) continue;
      for (const method of Object.keys(route.methods)) {
        if (['post', 'put', 'patch', 'delete'].includes(method)) {
          const path = route.path === '/' ? '' : route.path;
          routes.push(`${method.toUpperCase()} ${mount}${path}`);
        }
      }
    }
  }
  return routes;
}

describe('Audit coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let admin: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    admin = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({
      user: { id: admin.id, is_admin: true, name: 'Admin' },
    });
    for (const [mount, router] of MOUNTS) app.use(mount, router);
    server = await startServer(app);
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('lists every mutating route as audited, covered elsewhere, or exempt', () => {
    const listed = new Set([
      ...CASES.map((c) => c.route),
      ...Object.keys(COVERED_ELSEWHERE),
      ...Object.keys(EXEMPT),
    ]);
    const routes = mutatingRoutes();
    expect(routes.filter((r) => !listed.has(r))).toEqual([]);
    // Catch stale entries for routes that no longer exist.
    expect([...listed].filter((r) => !routes.includes(r))).toEqual([]);
  });

  it.each(
    CASES.map((c) => [c.variant ? `${c.route} (${c.variant})` : c.route, c]),
  )('%s writes an audit entry', async (_title, auditCase) => {
    const { path, body, expect: expected } = await auditCase.arrange(testDb.db);
    const method = auditCase.route.split(' ')[0];

    const res = await jsonRequest(method, `${server.baseUrl}${path}`, body);
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);

    const rows = await testDb.db.all(
      'SELECT * FROM audit_log WHERE action = ?',
      [expected.action],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...expected, user_id: admin.id });
  });
});
