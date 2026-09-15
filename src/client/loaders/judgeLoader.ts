import type { LoaderFunctionArgs } from 'react-router-dom';

export async function judgeLoader({ request }: LoaderFunctionArgs) {
  const response = await fetch('/scoresheet/templates', {
    signal: request.signal,
  });

  if (!response.ok) {
    throw new Response('Failed to load templates', {
      status: response.status,
    });
  }

  return response.json();
}
