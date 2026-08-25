import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import queueRoutes from '../../src/server/routes/queue';
import { createTestDb, type TestDb } from '../sql/helpers/testDb';
import {
  createTestApp,
  http,
  startServer,
  type TestServerHandle,
} from './helpers/testServer';
import {
  seedBracket,
  seedBracketGame,
  seedEvent,
  seedQueueItem,
  seedTeam,
} from './helpers/seed';

interface QueueRow {
  id: number;
  bracket_game_id: number | null;
  queue_type: string;
  queue_position: number;
  game_number: number | null;
  bracket_name: string | null;
  seeding_team_id: number | null;
}

describe('Bracket queue play order', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const app = createTestApp({ user: { id: 1, is_admin: false } });
    app.use('/queue', queueRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function getQueue(eventId: number): Promise<QueueRow[]> {
    const response = await http.get<QueueRow[]>(
      `${baseUrl}/queue/event/${eventId}`,
    );
    expect(response.status).toBe(200);
    return response.json;
  }

  it('populates one bracket by canonical play_order', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const bracket = await seedBracket(testDb.db, {
      event_id: event.id,
      bracket_size: 16,
    });
    const canonicalGameNumbers = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 10, 14, 11, 15, 12, 16, 17, 19, 18,
      20, 25, 26, 21, 22, 23, 24, 28, 27, 29, 30, 31,
    ];

    for (const [index, gameNumber] of canonicalGameNumbers.entries()) {
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: gameNumber,
        play_order: index + 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
    }

    const response = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
    });

    expect(response.status).toBe(200);
    expect((response.json as { created: number }).created).toBe(
      canonicalGameNumbers.length,
    );
    expect((await getQueue(event.id)).map((row) => row.game_number)).toEqual(
      canonicalGameNumbers,
    );
  });

  it('round-robins equal-sized brackets by bracket id', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const alpha = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Alpha',
      bracket_size: 8,
    });
    const beta = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Beta',
      bracket_size: 8,
    });

    for (const bracket of [alpha, beta]) {
      for (let playOrder = 1; playOrder <= 3; playOrder++) {
        await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: playOrder,
          play_order: playOrder,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        });
      }
    }

    await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
    });

    expect(
      (await getQueue(event.id)).map(
        (row) => `${row.bracket_name}:${row.game_number}`,
      ),
    ).toEqual(['Alpha:1', 'Beta:1', 'Alpha:2', 'Beta:2', 'Alpha:3', 'Beta:3']);
  });

  it('proportionally interleaves brackets of different sizes', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const large = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Large',
      bracket_size: 16,
    });
    const small = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Small',
      bracket_size: 8,
    });

    for (const [bracket, gameCount] of [
      [large, 31],
      [small, 15],
    ] as const) {
      for (let playOrder = 1; playOrder <= gameCount; playOrder++) {
        await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: playOrder,
          play_order: playOrder,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        });
      }
    }

    await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
    });
    const queue = await getQueue(event.id);

    expect(queue).toHaveLength(46);
    expect(queue.slice(-2).map((row) => row.bracket_name)).toEqual([
      'Large',
      'Small',
    ]);
    expect(queue.at(-2)?.game_number).toBe(31);
    expect(queue.at(-1)?.game_number).toBe(15);
  });

  it('falls back to game_number when play_order is null', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });

    for (const gameNumber of [2, 1]) {
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: gameNumber,
        play_order: null,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
    }

    await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
    });

    expect((await getQueue(event.id)).map((row) => row.game_number)).toEqual([
      1, 2,
    ]);
  });

  it('rebuilds bracket rows at their previous anchor and preserves seeding rows', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const oldGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      play_order: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 2,
      play_order: 2,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const seedingA = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team1.id,
      seeding_round: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 2,
      bracket_game_id: oldGame.id,
    });
    const seedingB = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 3,
      seeding_team_id: team2.id,
      seeding_round: 1,
    });

    await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
    });
    const queue = await getQueue(event.id);

    expect(queue.map((row) => row.queue_type)).toEqual([
      'seeding',
      'bracket',
      'bracket',
      'seeding',
    ]);
    expect(
      queue.filter((row) => row.queue_type === 'seeding').map((row) => row.id),
    ).toEqual([seedingA.id, seedingB.id]);
    expect(queue.map((row) => row.queue_position)).toEqual([1, 2, 3, 4]);
  });

  it('uses bracket_id as a non-destructive legacy filter', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const alpha = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Alpha',
    });
    const beta = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Beta',
    });
    const alphaGame = await seedBracketGame(testDb.db, {
      bracket_id: alpha.id,
      game_number: 1,
      play_order: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const betaGame = await seedBracketGame(testDb.db, {
      bracket_id: beta.id,
      game_number: 1,
      play_order: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const oldAlphaRow = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 1,
      bracket_game_id: alphaGame.id,
    });
    const betaRow = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 2,
      bracket_game_id: betaGame.id,
      status: 'called',
    });

    await http.post(`${baseUrl}/queue/populate-from-bracket`, {
      event_id: event.id,
      bracket_id: alpha.id,
    });
    const queue = await getQueue(event.id);

    expect(queue.map((row) => row.bracket_name)).toEqual(['Alpha', 'Beta']);
    expect(queue[0].id).not.toBe(oldAlphaRow.id);
    expect(queue[1].id).toBe(betaRow.id);
  });

  it('sync inserts newly eligible games before a greater canonical key', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const newGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 3,
      play_order: 3,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    const laterGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 5,
      play_order: 5,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team1.id,
      seeding_round: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 2,
      bracket_game_id: laterGame.id,
    });

    const response = await http.get<QueueRow[]>(
      `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
    );

    expect(response.status).toBe(200);
    expect(response.json.map((row) => row.bracket_game_id)).toEqual([
      newGame.id,
      laterGame.id,
    ]);
    const fullQueue = await getQueue(event.id);
    expect(fullQueue.map((row) => row.queue_type)).toEqual([
      'seeding',
      'bracket',
      'bracket',
    ]);
    expect(fullQueue.map((row) => row.queue_position)).toEqual([1, 2, 3]);
  });

  it('sync plans several cross-bracket insertions in one interleaved pass', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const alpha = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Alpha',
    });
    const beta = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Beta',
    });
    const newGames: Array<{ id: number }> = [];
    const laterGames: Array<{ id: number }> = [];

    for (const bracket of [alpha, beta]) {
      newGames.push(
        await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: 2,
          play_order: 2,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        }),
      );
      laterGames.push(
        await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: 3,
          play_order: 3,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        }),
      );
    }
    for (const [index, game] of laterGames.entries()) {
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: index + 1,
        bracket_game_id: game.id,
      });
    }

    const response = await http.get<QueueRow[]>(
      `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
    );

    expect(response.status).toBe(200);
    expect(response.json.map((row) => row.bracket_game_id)).toEqual([
      newGames[0].id,
      newGames[1].id,
      laterGames[0].id,
      laterGames[1].id,
    ]);
    expect(response.json.map((row) => row.queue_position)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('sync preserves the relative order of manually reordered bracket rows', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const games = new Map<number, { id: number }>();
    for (const playOrder of [2, 3, 5]) {
      games.set(
        playOrder,
        await seedBracketGame(testDb.db, {
          bracket_id: bracket.id,
          game_number: playOrder,
          play_order: playOrder,
          team1_id: team1.id,
          team2_id: team2.id,
          status: 'ready',
        }),
      );
    }
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 1,
      bracket_game_id: games.get(5)!.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      queue_position: 2,
      bracket_game_id: games.get(2)!.id,
    });

    const response = await http.get<QueueRow[]>(
      `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
    );

    expect(response.status).toBe(200);
    expect(response.json.map((row) => row.game_number)).toEqual([3, 5, 2]);
  });
});
