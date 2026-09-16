import {
  redirect,
  redirectDocument,
  type LoaderFunctionArgs,
} from 'react-router-dom';
import type { Event } from '../utils/eventStatus';

export const SELECTED_EVENT_STORAGE_KEY = 'colosseum_selected_event_id';

interface AuthenticatedUser {
  isAdmin: boolean;
}

export async function adminLoader({ request }: { request: Request }) {
  const response = await fetch('/auth/user', {
    credentials: 'include',
    signal: request.signal,
  });

  if (response.status === 401) {
    const url = new URL(request.url);
    const returnTo = `${url.pathname}${url.search}${url.hash}`;
    const loginUrl = `/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
    return redirectDocument(loginUrl);
  }

  if (!response.ok) {
    throw response;
  }

  const user = (await response.json()) as AuthenticatedUser;
  if (!user.isAdmin) {
    return redirectDocument('/auth/access-denied');
  }

  if (new URL(request.url).pathname === '/admin') {
    return adminIndexLoader();
  }

  return null;
}

function parseEventId(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;

  const eventId = Number(value);
  return Number.isSafeInteger(eventId) && eventId > 0 && eventId <= 2147483647
    ? eventId
    : null;
}

export function adminIndexLoader() {
  let storedEventId: string | null = null;

  try {
    storedEventId = localStorage.getItem(SELECTED_EVENT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; the event list remains a safe destination.
  }

  const eventId = parseEventId(storedEventId);
  if (eventId === null) {
    if (storedEventId !== null) {
      try {
        localStorage.removeItem(SELECTED_EVENT_STORAGE_KEY);
      } catch {
        // Ignore unavailable storage.
      }
    }
    return redirect('/admin/events');
  }

  return redirect(`/admin/events/${eventId}`);
}

export async function adminEventLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<Event> {
  const eventId = parseEventId(params.eventId);
  if (eventId === null) {
    throw new Response('Event not found.', {
      status: 404,
      statusText: 'Not Found',
    });
  }

  const response = await fetch(`/events/${eventId}`, {
    credentials: 'include',
    signal: request.signal,
  });

  if (response.status === 404) {
    throw new Response('Event not found.', {
      status: 404,
      statusText: 'Not Found',
    });
  }

  if (!response.ok) throw response;

  return (await response.json()) as Event;
}
