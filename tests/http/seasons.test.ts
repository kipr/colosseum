import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import seasonsRoutes from '../../src/server/routes/seasons';
import { createTestDb, type TestDb } from '../sql/helpers/testDb';
import { seedUser } from './helpers/seed';
import {
  createTestApp,
  http,
  startServer,
  type TestAppOptions,
  type TestServerHandle,
} from './helpers/testServer';

interface Season {
  id: number;
  name: string;
  sort_order: number;
}

interface ErrorBody {
  error: string;
}

type Caller = 'anonymous' | 'judge' | 'member' | 'admin';

describe('Season routes', () => {
  let testDb: TestDb;
  let users: Record<'admin' | 'member', { id: number; is_admin: boolean }>;
  let servers: TestServerHandle[];

  beforeEach(async () => {
    servers = [];
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    users = {
      admin: {
        ...(await seedUser(testDb.db, { is_admin: true })),
        is_admin: true,
      },
      member: {
        ...(await seedUser(testDb.db, {
          email: 'member@example.com',
          google_id: 'google-member',
          is_admin: false,
        })),
        is_admin: false,
      },
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.map((server) => server.close()));
    __setTestDatabaseAdapter(null);
    testDb?.close();
  });

  async function endpoint(caller: Caller = 'admin'): Promise<string> {
    let options: TestAppOptions = {};
    if (caller === 'admin' || caller === 'member') {
      options = { user: users[caller] };
    } else if (caller === 'judge') {
      options = {
        judgeSession: {
          templateId: 1,
          eventIds: [1],
          conversationKey: 'season-test-judge',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      };
    }
    const app = createTestApp(options);
    app.use('/events/seasons', seasonsRoutes);
    const server = await startServer(app);
    servers.push(server);
    return `${server.baseUrl}/events/seasons`;
  }

  async function expectNoWrites() {
    expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([]);
    expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
  }

  describe('authorization', () => {
    it.each([
      ['anonymous', 401],
      ['judge', 401],
      ['member', 200],
      ['admin', 200],
    ] as const)('GET as %s returns %i', async (caller, status) => {
      const url = await endpoint(caller);
      const response = await http.get(url);
      expect(response.status).toBe(status);
      expect(response.json).toEqual(
        status === 200 ? [] : { error: 'Authentication required' },
      );
      await expectNoWrites();
    });

    it.each(['anonymous', 'judge', 'member'] as const)(
      'rejects forged POST fields from %s without writing rows or audits',
      async (caller) => {
        const url = await endpoint(caller);
        const response = await http.post(url, {
          name: 'Forged season',
          sort_order: 10,
          id: 999,
          is_admin: true,
          user: users.admin,
          user_id: users.admin.id,
          created_by: users.admin.id,
          status: 'complete',
          spectator_results_released: 1,
          event_id: 1,
          action: 'season_created',
        });
        expect(response.status).toBe(403);
        expect(response.json).toEqual({ error: 'Admin access required' });
        await expectNoWrites();
      },
    );
  });

  it('creates the exact season representation with default sort order and actor audit', async () => {
    const url = await endpoint();
    const response = await http.post<Season>(url, {
      name: 'Spring  Finals',
      id: 999,
      user_id: users.member.id,
      created_by: users.member.id,
      event_id: 999,
      action: 'forged_action',
      entity_type: 'event',
      old_value: { status: 'setup' },
      new_value: { status: 'complete' },
      status: 'complete',
      spectator_results_released: 1,
    });
    expect(response.status).toBe(201);
    expect(response.json).toEqual({
      id: expect.any(Number),
      name: 'Spring  Finals',
      sort_order: 0,
    });
    expect(response.json.id).toBeGreaterThan(0);
    expect(response.json.id).not.toBe(999);
    expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([
      response.json,
    ]);
    const audits = await testDb.db.all('SELECT * FROM audit_log');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      user_id: users.admin.id,
      event_id: null,
      action: 'season_created',
      entity_type: 'season',
      entity_id: response.json.id,
      old_value: null,
      ip_address: expect.any(String),
    });
    expect(JSON.parse(audits[0].new_value)).toEqual(response.json);
    expect((await http.get<Season[]>(url)).json).toEqual([response.json]);
    expect(await testDb.db.all('SELECT id FROM audit_log')).toHaveLength(1);
  });

  it('lists only explicit season fields sorted by sort_order DESC then id DESC for authenticated callers', async () => {
    const url = await endpoint();
    const seasons: Season[] = [];
    for (const [name, sort_order] of [
      ['Lower', -5],
      ['Earlier tie', 12],
      ['Default', 0],
      ['Later tie', 12],
    ] as const) {
      const response = await http.post<Season>(url, { name, sort_order });
      expect(response.status).toBe(201);
      expect(response.json).toEqual({
        id: expect.any(Number),
        name,
        sort_order,
      });
      seasons.push(response.json);
    }
    for (const caller of ['admin', 'member'] as const) {
      const response = await http.get<Season[]>(await endpoint(caller));
      expect(response.status).toBe(200);
      expect(response.json).toEqual([
        seasons[3],
        seasons[1],
        seasons[2],
        seasons[0],
      ]);
    }
    expect(await testDb.db.all('SELECT id FROM audit_log')).toHaveLength(4);
  });

  describe('name validation', () => {
    it.each([
      ['missing body', undefined],
      ['missing name', {}],
      ['array body', []],
      ['array containing a season', [{ name: 'Not an object' }]],
      ['null name', { name: null }],
      ['boolean name', { name: true }],
      ['number name', { name: 2026 }],
      ['array name', { name: ['2026'] }],
      ['object name', { name: { name: '2026' } }],
      ['empty name', { name: '' }],
      ['only whitespace', { name: ' \t\r\n' }],
      ['leading space', { name: ' 2026' }],
      ['trailing space', { name: '2026 ' }],
      ['leading tab', { name: '\t2026' }],
      ['trailing newline', { name: '2026\n' }],
      ['101 ASCII characters', { name: 'x'.repeat(101) }],
      ['101 multibyte characters', { name: 'é'.repeat(101) }],
      ['101 astral characters', { name: '😀'.repeat(101) }],
      ['101 combining code points', { name: 'e\u0301'.repeat(50) + 'e' }],
      ['NUL character', { name: 'Season\u0000name' }],
      ['unpaired high surrogate', { name: 'Season\ud800' }],
      ['unpaired low surrogate', { name: '\udc00Season' }],
    ])(
      'rejects %s with an actionable 400 and no writes',
      async (_label, body) => {
        const response = await http.post<ErrorBody>(await endpoint(), body);
        expect(response.status).toBe(400);
        expect(response.json.error).toMatch(/name|body/i);
        await expectNoWrites();
      },
    );

    it.each([
      ['one character', 'A'],
      ['100 ASCII characters', 'x'.repeat(100)],
      ['100 multibyte characters', 'é'.repeat(100)],
      ['100 astral characters', '😀'.repeat(100)],
      ['100 combining code points', 'e\u0301'.repeat(50)],
      ['internal whitespace', 'Spring  Finals\t2026\nChampionship'],
      ['SQL-like text', "Finals'); DROP TABLE seasons;--"],
    ])('preserves %s verbatim', async (_label, name) => {
      const response = await http.post<Season>(await endpoint(), { name });
      expect(response.status).toBe(201);
      expect(response.json).toEqual({
        id: expect.any(Number),
        name,
        sort_order: 0,
      });
      expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([
        response.json,
      ]);
    });

    it.each([
      ['vertical tab', '\u000b'],
      ['form feed', '\u000c'],
      ['no-break space', '\u00a0'],
      ['next line', '\u0085'],
      ['em space', '\u2003'],
      ['line separator', '\u2028'],
      ['narrow no-break space', '\u202f'],
      ['ideographic space', '\u3000'],
      ['BOM (JavaScript trims it)', '\ufeff'],
    ])(
      'matches PostgreSQL boundary whitespace semantics for %s',
      async (_label, boundary) => {
        const url = await endpoint();
        for (const name of [`${boundary}Season`, `Season${boundary}`]) {
          const postgres = await testDb.db.get<{ valid: boolean }>(
            `SELECT name !~ '^[[:space:]]|[[:space:]]$' AS valid
           FROM (SELECT ?::text AS name) input`,
            [name],
          );
          const response = await http.post<Season | ErrorBody>(url, { name });
          expect(response.status).toBe(postgres!.valid ? 201 : 400);
          if (postgres!.valid) {
            expect(response.json).toEqual({
              id: expect.any(Number),
              name,
              sort_order: 0,
            });
            expect(
              await testDb.db.get('SELECT name FROM seasons WHERE id = ?', [
                (response.json as Season).id,
              ]),
            ).toEqual({ name });
          } else {
            expect((response.json as ErrorBody).error).toMatch(
              /name.*whitespace/i,
            );
          }
        }
        const seasons = await testDb.db.all('SELECT * FROM seasons');
        const audits = await testDb.db.all('SELECT * FROM audit_log');
        expect(audits).toHaveLength(seasons.length);
      },
    );
  });

  describe('sort_order validation', () => {
    it.each([-2147483648, -1, 0, 1, 2147483647])(
      'accepts signed 32-bit integer %i',
      async (sort_order) => {
        const response = await http.post<Season>(await endpoint(), {
          name: 'Ordered season',
          sort_order,
        });
        expect(response.status).toBe(201);
        expect(response.json).toEqual({
          id: expect.any(Number),
          name: 'Ordered season',
          sort_order,
        });
        expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([
          response.json,
        ]);
      },
    );

    it.each([
      ['null', null],
      ['false', false],
      ['true', true],
      ['empty string', ''],
      ['numeric string', '1'],
      ['negative numeric string', '-1'],
      ['whitespace-padded string', ' 1 '],
      ['trailing junk', '1season'],
      ['SQL-like text', '1; DROP TABLE seasons'],
      ['array', [1]],
      ['object', { value: 1 }],
      ['fraction', 0.5],
      ['negative fraction', -0.5],
      ['below integer range', -2147483649],
      ['above integer range', 2147483648],
      ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s without coercion or writes', async (_label, sort_order) => {
      const response = await http.post<ErrorBody>(await endpoint(), {
        name: 'Invalid order',
        sort_order,
      });
      expect(response.status).toBe(400);
      expect(response.json.error).toMatch(/sort_order.*integer/i);
      await expectNoWrites();
    });
  });

  it('returns 409 for duplicate names regardless of case without another row or audit', async () => {
    const url = await endpoint();
    const winner = await http.post<Season>(url, { name: 'Spring Finals' });
    expect(winner.status).toBe(201);
    for (const name of ['Spring Finals', 'spring finals', 'SPRING FINALS']) {
      const response = await http.post<ErrorBody>(url, {
        name,
        sort_order: 50,
      });
      expect(response.status).toBe(409);
      expect(response.json.error).toMatch(/season.*name.*already exists/i);
    }
    expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([winner.json]);
    expect(await testDb.db.all('SELECT id FROM audit_log')).toHaveLength(1);
  });

  it('resolves concurrent case-variant creates with exactly one usable season and one 409', async () => {
    const url = await endpoint();
    const responses = await Promise.all([
      http.post<Season | ErrorBody>(url, {
        name: 'Race Season',
        sort_order: 7,
      }),
      http.post<Season | ErrorBody>(url, {
        name: 'rACE sEASON',
        sort_order: 9,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const winner = responses.find((response) => response.status === 201)!
      .json as Season;
    const loser = responses.find((response) => response.status === 409)!
      .json as ErrorBody;
    expect(loser.error).toMatch(/season.*name.*already exists/i);
    expect(await testDb.db.all('SELECT * FROM seasons')).toEqual([winner]);
    const audits = await testDb.db.all('SELECT * FROM audit_log');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      user_id: users.admin.id,
      action: 'season_created',
      entity_type: 'season',
      entity_id: winner.id,
      event_id: null,
    });
    expect(JSON.parse(audits[0].new_value)).toEqual(winner);
    await testDb.db.run(
      `INSERT INTO events (name, spectator_listing, season_id)
       VALUES (?, 'archive', ?)`,
      ['Uses the winning season', winner.id],
    );
    expect(
      await testDb.db.get(
        `SELECT e.season_id, e.spectator_listing, s.name
         FROM events e JOIN seasons s ON s.id = e.season_id`,
      ),
    ).toEqual({
      season_id: winner.id,
      spectator_listing: 'archive',
      name: winner.name,
    });
    expect((await http.get<Season[]>(url)).json).toEqual([winner]);
  });

  it('does not write a success audit when season persistence fails', async () => {
    const run = testDb.db.run.bind(testDb.db);
    vi.spyOn(testDb.db, 'run').mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO seasons')) {
        throw new Error('Injected season persistence failure');
      }
      return run(sql, params);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await http.post<ErrorBody>(await endpoint(), {
      name: 'Failed season',
    });
    expect(response.status).toBe(500);
    expect(response.json).toEqual({ error: 'Internal server error' });
    await expectNoWrites();
  });

  it.each(['XX000', '23505'])(
    'retains the season after post-write audit failure (%s), without misreporting a name conflict',
    async (code) => {
      const run = testDb.db.run.bind(testDb.db);
      vi.spyOn(testDb.db, 'run').mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO audit_log')) {
          throw Object.assign(new Error('Injected audit failure'), { code });
        }
        return run(sql, params);
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const url = await endpoint();
      const response = await http.post<ErrorBody>(url, {
        name: 'Durable season',
      });
      expect(response.status).toBe(500);
      expect(response.json).toEqual({ error: 'Internal server error' });
      const seasons = await testDb.db.all<Season>('SELECT * FROM seasons');
      expect(seasons).toEqual([
        { id: expect.any(Number), name: 'Durable season', sort_order: 0 },
      ]);
      expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
      expect((await http.get<Season[]>(url)).json).toEqual(seasons);
      const retry = await http.post<ErrorBody>(url, { name: 'durable season' });
      expect(retry.status).toBe(409);
      expect(await testDb.db.all('SELECT * FROM seasons')).toEqual(seasons);
    },
  );
});
