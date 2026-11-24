/** Anonymous HTTP coverage for spectator event listings and metadata. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  http,
} from './helpers/testServer';
import { seedEvent, seedUser, type SeedEventData } from './helpers/seed';
import eventsRoutes from '../../src/server/routes/events';

type Listing = 'current' | 'archive';
interface Season {
  id: number;
  name: string;
  sort_order: number;
}
interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  final_scores_available: boolean;
  spectator_listing: Listing;
  season_id: number | null;
  season_name: string | null;
  season_sort_order: number | null;
}

const PUBLIC_EVENT_KEYS = [
  'id',
  'name',
  'status',
  'event_date',
  'location',
  'seeding_rounds',
  'double_seeding_rounds',
  'final_scores_available',
  'spectator_listing',
  'season_id',
  'season_name',
  'season_sort_order',
].sort();

const invalidSelectors = [
  'listing=',
  'listing=archived',
  'listing=all',
  'listing=Archive',
  'listing=null',
  'listing=true',
  'listing=1',
  'listing=%20current',
  'listing=archive%20',
  'listing=current%00',
  'listing=current,archive',
  'listing=current&listing=archive',
  'listing=archive&listing=archive',
  'listing=current&%6cisting=current',
  'listing[]=archive',
  'listing[0]=archive',
  'listing[value]=archive',
  'listing=current&listing[]=archive',
  'season_id=',
  'season_id=0',
  'season_id=-1',
  'season_id=01',
  'season_id=00',
  'season_id=%2B1',
  'season_id=%201',
  'season_id=1%20',
  'season_id=1.0',
  'season_id=1.5',
  'season_id=1e0',
  'season_id=0x1',
  'season_id=NaN',
  'season_id=Infinity',
  'season_id=null',
  'season_id=true',
  'season_id=2147483648',
  'season_id=9007199254740993',
  'season_id=1junk',
  'season_id=1%00',
  'season_id=1%20OR%201=1',
  'season_id=1&season_id=2',
  'season_id=1&season_id=1',
  'season_id=1&season_%69d=1',
  'season_id[]=1',
  'season_id[0]=1',
  'season_id[id]=1',
  'season_id=1&season_id[]=2',
];

describe('Public Events API (anonymous)', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    const app = createTestApp();
    app.use('/events', eventsRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function seedSeason(
    id: number,
    name: string,
    sortOrder: number,
  ): Promise<Season> {
    await testDb.db.run(
      'INSERT INTO seasons (id, name, sort_order) VALUES (?, ?, ?)',
      [id, name, sortOrder],
    );
    return { id, name, sort_order: sortOrder };
  }

  async function seedPublicEvent({
    listing = 'current',
    season = null,
    released = false,
    createdAt = '2026-01-01 00:00:00',
    ...data
  }: SeedEventData & {
    listing?: Listing;
    season?: Season | null;
    released?: boolean;
    createdAt?: string;
  }): Promise<PublicEvent> {
    const event = await seedEvent(testDb.db, data);
    await testDb.db.run(
      `UPDATE events SET spectator_listing = ?, season_id = ?,
       spectator_results_released = ?, created_at = ? WHERE id = ?`,
      [listing, season?.id ?? null, released ? 1 : 0, createdAt, event.id],
    );
    return {
      id: event.id,
      name: data.name ?? 'Test Event',
      status: data.status ?? 'setup',
      event_date: data.event_date ?? null,
      location: data.location ?? null,
      seeding_rounds: data.seeding_rounds ?? 3,
      double_seeding_rounds: data.double_seeding_rounds ?? 0,
      final_scores_available: data.status === 'complete' && released,
      spectator_listing: listing,
      season_id: season?.id ?? null,
      season_name: season?.name ?? null,
      season_sort_order: season?.sort_order ?? null,
    };
  }

  async function expectListing(query: string, expected: PublicEvent[]) {
    const res = await http.get<PublicEvent[]>(
      `${baseUrl}/events/public${query}`,
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual(expected);
    for (const event of res.json) {
      expect(Object.keys(event).sort()).toEqual(PUBLIC_EVENT_KEYS);
    }
    return res.json;
  }

  it.each(['', '?listing=current', '?listing=archive'])(
    'returns an empty array for an empty listing %s',
    async (query) => {
      await expectListing(query, []);
    },
  );

  it('defaults to current and partitions mixed seasons by placement, not lifecycle or season membership', async () => {
    const season = await seedSeason(101, 'Season, not event name', 12);
    const current = await seedPublicEvent({
      name: 'Current complete with season',
      status: 'complete',
      season,
      released: true,
      event_date: '2026-03-01',
    });
    const unseasoned = await seedPublicEvent({
      name: 'Current setup without season',
      status: 'setup',
      event_date: '2026-02-01',
    });
    const archive = await seedPublicEvent({
      name: 'Archive active unreleased',
      status: 'active',
      listing: 'archive',
      season,
      event_date: '2026-04-01',
    });
    await seedPublicEvent({
      name: 'Hidden current',
      status: 'archived',
      season,
      released: true,
    });
    await seedPublicEvent({
      name: 'Hidden archive',
      status: 'archived',
      listing: 'archive',
      season,
      released: true,
    });

    const implicit = await expectListing('', [current, unseasoned]);
    expect(
      await expectListing('?listing=current', [current, unseasoned]),
    ).toEqual(implicit);
    await expectListing('?listing=archive', [archive]);
    for (const listing of ['current', 'archive'] as const) {
      await expectListing(
        `?listing=${listing}&status=archived&spectator_results_released=1&final_scores_available=true`,
        listing === 'current' ? [current, unseasoned] : [archive],
      );
    }
  });

  it('filters either placement by a canonical season ID, including empty, hidden-only and missing seasons', async () => {
    const seasonA = await seedSeason(101, 'Season A', 1);
    const seasonB = await seedSeason(102, 'Season B', 2);
    const empty = await seedSeason(103, 'Empty season', 3);
    const hidden = await seedSeason(104, 'Hidden-only season', 4);
    const currentA = await seedPublicEvent({
      name: 'Current A',
      season: seasonA,
    });
    const archiveA = await seedPublicEvent({
      name: 'Archive A',
      listing: 'archive',
      season: seasonA,
    });
    const currentB = await seedPublicEvent({
      name: 'Current B',
      season: seasonB,
    });
    const archiveB = await seedPublicEvent({
      name: 'Archive B',
      listing: 'archive',
      season: seasonB,
    });
    await seedPublicEvent({ name: 'Unseasoned current decoy' });
    for (const listing of ['current', 'archive'] as const) {
      await seedPublicEvent({
        name: `Hidden ${listing}`,
        listing,
        season: hidden,
        status: 'archived',
        released: true,
      });
    }

    await expectListing(`?season_id=${seasonA.id}`, [currentA]);
    for (const listing of ['current', 'archive'] as const) {
      await expectListing(`?listing=${listing}&season_id=${seasonA.id}`, [
        listing === 'current' ? currentA : archiveA,
      ]);
      await expectListing(`?listing=${listing}&season_id=${seasonB.id}`, [
        listing === 'current' ? currentB : archiveB,
      ]);
      for (const id of [empty.id, hidden.id, 99999, 2147483647]) {
        await expectListing(`?listing=${listing}&season_id=${id}`, []);
      }
    }
  });

  it.each(['', '?listing=current', '?listing=archive'])(
    'accepts the maximum PostgreSQL integer season ID %s',
    async (query) => {
      const season = await seedSeason(2147483647, 'Maximum ID season', 0);
      const current = await seedPublicEvent({
        name: 'Maximum current',
        season,
      });
      const archive = await seedPublicEvent({
        name: 'Maximum archive',
        listing: 'archive',
        season,
      });
      await expectListing(
        `${query}${query ? '&' : '?'}season_id=${season.id}`,
        [query.includes('archive') ? archive : current],
      );
    },
  );

  describe.each(['', 'listing=archive&'])(
    'rejects malformed selectors (%s)',
    (prefix) => {
      it.each(invalidSelectors)(
        'returns 400, never a broadened list, for %s',
        async (query) => {
          const season = await seedSeason(1, 'Sentinel season', 1);
          await seedPublicEvent({ name: 'Current sentinel', season });
          await seedPublicEvent({
            name: 'Archive sentinel',
            listing: 'archive',
            season,
          });
          const res = await http.get(
            `${baseUrl}/events/public?${prefix}${query}`,
          );
          expect(res.status).toBe(400);
          expect(res.json).not.toBeInstanceOf(Array);
        },
      );
    },
  );

  it('orders current by event date NULLS LAST, creation time and ID, never by season', async () => {
    const high = await seedSeason(101, 'High season', 100);
    const low = await seedSeason(102, 'Low season', -100);
    const undatedOld = await seedPublicEvent({
      name: 'Undated old',
      season: high,
      createdAt: '2027-01-01 00:00:00',
    });
    const undatedNew = await seedPublicEvent({
      name: 'Undated new',
      createdAt: '2028-01-01 00:00:00',
    });
    const oldDate = await seedPublicEvent({
      name: 'Old date high season',
      season: high,
      event_date: '2025-01-01',
      createdAt: '2029-01-01 00:00:00',
    });
    const oldCreation = await seedPublicEvent({
      name: 'Same date old creation',
      season: high,
      event_date: '2026-01-01',
      createdAt: '2025-01-01 00:00:00',
    });
    const lowerId = await seedPublicEvent({
      name: 'Same date and creation lower ID',
      event_date: '2026-01-01',
    });
    const higherId = await seedPublicEvent({
      name: 'Same date and creation higher ID',
      season: low,
      event_date: '2026-01-01',
    });
    const newDate = await seedPublicEvent({
      name: 'New date low season',
      season: low,
      event_date: '2026-02-01',
      createdAt: '2024-01-01 00:00:00',
    });
    await seedPublicEvent({
      name: 'Archive newer decoy',
      listing: 'archive',
      season: high,
      event_date: '2030-01-01',
    });
    const expected = [
      newDate,
      higherId,
      lowerId,
      oldCreation,
      oldDate,
      undatedNew,
      undatedOld,
    ];
    await expectListing('', expected);
    await expectListing('?listing=current', expected);
  });

  it('orders archive by season sort order, season ID, then date NULLS LAST, creation time and event ID', async () => {
    const highSort = await seedSeason(
      101,
      'First despite smaller season ID',
      20,
    );
    const olderSeason = await seedSeason(201, 'Older tied season', 10);
    const newerSeason = await seedSeason(202, 'Newer tied season', 10);
    const lowSort = await seedSeason(301, 'Last despite largest season ID', -1);
    const last = await seedPublicEvent({
      name: 'Low season future event',
      listing: 'archive',
      season: lowSort,
      event_date: '2030-01-01',
    });
    const older = await seedPublicEvent({
      name: 'Older tied season future event',
      listing: 'archive',
      season: olderSeason,
      event_date: '2029-01-01',
    });
    const undatedOld = await seedPublicEvent({
      name: 'Newer season undated old',
      listing: 'archive',
      season: newerSeason,
      createdAt: '2027-01-01 00:00:00',
    });
    const undatedNew = await seedPublicEvent({
      name: 'Newer season undated new',
      listing: 'archive',
      season: newerSeason,
      createdAt: '2028-01-01 00:00:00',
    });
    const oldDate = await seedPublicEvent({
      name: 'Newer season old date',
      listing: 'archive',
      season: newerSeason,
      event_date: '2025-01-01',
      createdAt: '2029-01-01 00:00:00',
    });
    const oldCreation = await seedPublicEvent({
      name: 'Newer season old creation',
      listing: 'archive',
      season: newerSeason,
      event_date: '2026-01-01',
      createdAt: '2025-01-01 00:00:00',
    });
    const lowerId = await seedPublicEvent({
      name: 'Newer season lower event ID',
      listing: 'archive',
      season: newerSeason,
      event_date: '2026-01-01',
    });
    const higherId = await seedPublicEvent({
      name: 'Newer season higher event ID',
      listing: 'archive',
      season: newerSeason,
      event_date: '2026-01-01',
    });
    const newDate = await seedPublicEvent({
      name: 'Newer season new date',
      listing: 'archive',
      season: newerSeason,
      event_date: '2026-02-01',
      createdAt: '2024-01-01 00:00:00',
    });
    const first = await seedPublicEvent({
      name: 'High sort undated event',
      listing: 'archive',
      season: highSort,
    });
    await seedPublicEvent({
      name: 'Current same season decoy',
      season: highSort,
      event_date: '2031-01-01',
    });
    await seedPublicEvent({
      name: 'Hidden high season decoy',
      listing: 'archive',
      season: highSort,
      status: 'archived',
      event_date: '2032-01-01',
    });
    await expectListing('?listing=archive', [
      first,
      newDate,
      higherId,
      lowerId,
      oldCreation,
      oldDate,
      undatedNew,
      undatedOld,
      older,
      last,
    ]);
    await expectListing(`?listing=archive&season_id=${newerSeason.id}`, [
      newDate,
      higherId,
      lowerId,
      oldCreation,
      oldDate,
      undatedNew,
      undatedOld,
    ]);
  });

  it.each([
    { listing: 'current' as const, withSeason: false },
    { listing: 'current' as const, withSeason: true },
    { listing: 'archive' as const, withSeason: true },
  ])(
    'returns identical exact flat list/detail allowlists for $listing (season=$withSeason)',
    async ({ listing, withSeason }) => {
      const season = withSeason
        ? await seedSeason(901, 'Season identity must not overwrite event', 37)
        : null;
      const creator = await seedUser(testDb.db, { is_admin: true });
      const expected = await seedPublicEvent({
        name: 'Public event identity',
        status: 'complete',
        event_date: '2026-03-01',
        location: 'Sentinel Arena',
        seeding_rounds: 4,
        double_seeding_rounds: 2,
        description: 'PRIVATE description',
        score_accept_mode: 'auto_accept_all',
        min_rest_minutes: 17,
        created_by: creator.id,
        listing,
        season,
        released: true,
      });
      const list = await expectListing(`?listing=${listing}`, [expected]);
      const detail = await http.get<PublicEvent>(
        `${baseUrl}/events/${expected.id}/public`,
      );
      expect(detail.status).toBe(200);
      expect(Object.keys(detail.json).sort()).toEqual(PUBLIC_EVENT_KEYS);
      expect(detail.json).toEqual(expected);
      expect(detail.json).toEqual(list[0]);
      if (season) expect(expected.id).not.toBe(season.id);
    },
  );

  it('returns 404 for a nonexistent detail', async () => {
    const res = await http.get(
      `${baseUrl}/events/99999/public?listing=archive`,
    );
    expect(res.status).toBe(404);
  });
});
