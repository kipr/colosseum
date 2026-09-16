import { redirectDocument } from 'react-router-dom';

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

  return null;
}
