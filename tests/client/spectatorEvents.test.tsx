// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SpectatorEvents from '../../src/client/pages/SpectatorEvents';
import type { PublicEvent } from '../../src/client/api/types';
import {
  createTestQueryClient,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';

vi.mock('../../src/client/components/Navbar', () => ({
  default: function NavbarStub() {
    return <nav data-testid="navbar-stub">Navbar</nav>;
  },
}));

registerQueryTestCleanup();

const sampleEvents: PublicEvent[] = [
  {
    id: 21,
    name: 'Active Tournament',
    status: 'active',
    event_date: '2026-06-15',
    location: 'E2E Test Arena',
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    final_scores_available: false,
  },
  {
    id: 22,
    name: 'Completed Cup',
    status: 'complete',
    event_date: '2026-05-01',
    location: 'Main Hall',
    seeding_rounds: 3,
    double_seeding_rounds: 2,
    final_scores_available: true,
  },
];

function LocationPath() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(queryClient = createTestQueryClient()) {
  return renderWithQuery(
    <>
      <LocationPath />
      <SpectatorEvents />
    </>,
    { queryClient, router: { initialEntries: ['/spectator'] } },
  );
}

describe('SpectatorEvents', () => {
  it('shows the loading message while the initial request is pending', async () => {
    let release!: (value: Response) => void;
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    renderPage();
    expect(screen.getByText('Loading events...')).toBeTruthy();
    release(jsonResponse(sampleEvents));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Active Tournament' }),
      ).toBeTruthy(),
    );
  });

  it('shows the empty card when the request succeeds with no events', async () => {
    stubFetch(() => Promise.resolve(jsonResponse([])));
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('No events are currently available.'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Loading events...')).toBeNull();
  });

  it('shows an error with Retry on the initial failure and recovers', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonErrorResponse(500, 'Failed to fetch events')),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Unable to load events.')).toBeTruthy(),
    );
    expect(screen.queryByText('No events are currently available.')).toBeNull();

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Active Tournament' }),
      ).toBeTruthy(),
    );
  });

  it('keeps cached cards visible when a background refresh fails', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    const { queryClient } = renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Completed Cup' }),
      ).toBeTruthy(),
    );

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonErrorResponse(503, 'Unavailable')),
    );
    await queryClient.refetchQueries({ queryKey: ['public', 'events'] });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't refresh events. Showing previously loaded results.",
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole('heading', { name: 'Active Tournament' }),
    ).toBeTruthy();

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Couldn't refresh events. Showing previously loaded results.",
        ),
      ).toBeNull(),
    );
    expect(screen.getByRole('heading', { name: 'Completed Cup' })).toBeTruthy();
  });

  it('shows a connection message when the initial request is paused offline', async () => {
    onlineManager.setOnline(false);
    stubFetch(() => Promise.resolve(jsonResponse(sampleEvents)));
    renderPage();
    expect(
      screen.getByText('Waiting for a network connection to load events.'),
    ).toBeTruthy();
    expect(screen.queryByText('Loading events...')).toBeNull();
  });

  it('renders event cards in order and navigates from click and keyboard', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(sampleEvents)));
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Completed Cup' }),
      ).toBeTruthy(),
    );

    const cards = document.querySelectorAll('.spectator-event-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Active Tournament');
    expect(cards[0]?.textContent).toContain('E2E Test Arena');
    expect(cards[0]?.textContent).toContain('Active');
    expect(cards[0]?.textContent).not.toContain('Final results available');
    expect(cards[1]?.textContent).toContain('Completed Cup');
    expect(cards[1]?.textContent).toContain('Main Hall');
    expect(cards[1]?.textContent).toContain('Final results available');

    fireEvent.click(cards[0]!);
    expect(screen.getByTestId('location').textContent).toBe(
      '/spectator/events/21?view=seeding',
    );

    fireEvent.keyDown(cards[1]!, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe(
      '/spectator/events/22?view=seeding',
    );

    fireEvent.keyDown(cards[1]!, { key: ' ' });
    expect(screen.getByTestId('location').textContent).toBe(
      '/spectator/events/22?view=seeding',
    );
  });
});
