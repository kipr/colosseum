/**
 * Resolves the Google OAuth callback URL from environment variables.
 *
 * Priority: GOOGLE_CALLBACK_URL > APP_URL + path > localhost fallback
 */
export function getGoogleCallbackUrl(): string {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }

  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return `${normalizedBaseUrl}/auth/google/callback`;
}
