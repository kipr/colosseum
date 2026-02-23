import { google } from 'googleapis';
import { getDatabase } from '../database/connection';
import { getGoogleCallbackUrl } from '../config/google';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  getGoogleCallbackUrl(),
);

// Buffer time before expiry to trigger refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check if a token is expired or will expire soon
 */
function isTokenExpiredOrExpiring(expiresAt: number | null): boolean {
  if (!expiresAt) return true; // No expiry info means we should refresh
  const now = Date.now();
  return now >= expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Refresh the access token using the refresh token
 */
async function doTokenRefresh(
  userId: number,
  userRefreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const db = await getDatabase();

  oauth2Client.setCredentials({
    refresh_token: userRefreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();
  const newAccessToken = credentials.access_token;
  const newRefreshToken = credentials.refresh_token;
  const expiryDate = credentials.expiry_date;

  if (!newAccessToken) {
    throw new Error('Failed to get new access token from Google');
  }

  // Calculate expiry time (Google returns expiry_date as timestamp in ms)
  // If not provided, assume 1 hour from now (standard Google token lifetime)
  const expiresAt = expiryDate || Date.now() + 3600 * 1000;

  // Update the database with new tokens and expiry time
  await db.run(
    `UPDATE users SET 
      access_token = ?, 
      refresh_token = ?, 
      token_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?`,
    [newAccessToken, newRefreshToken || userRefreshToken, expiresAt, userId],
  );

  return { accessToken: newAccessToken, expiresAt };
}

/**
 * Get a valid access token for a user, refreshing if necessary.
 * This should be called before any Google API request.
 */
export async function getValidAccessToken(userId: number): Promise<string> {
  const db = await getDatabase();
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.access_token) {
    throw new Error('No access token found. User needs to re-authenticate.');
  }

  if (!user.refresh_token) {
    throw new Error(
      'No refresh token available. Please log out and log back in to get a new refresh token.',
    );
  }

  // Check if token is expired or expiring soon
  if (isTokenExpiredOrExpiring(user.token_expires_at)) {
    try {
      const { accessToken } = await doTokenRefresh(userId, user.refresh_token);
      return accessToken;
    } catch (error: unknown) {
      console.error(
        'Proactive token refresh failed:',
        error instanceof Error ? error.message : error,
      );
      throw new Error(
        'Token refresh failed. Please log out and log back in to re-authenticate with Google.',
      );
    }
  }

  // Token should still be valid, but verify with Google as a safety check
  try {
    oauth2Client.setCredentials({
      access_token: user.access_token,
      refresh_token: user.refresh_token,
    });

    // Try to get token - this will refresh if needed
    const tokenResult = await oauth2Client.getAccessToken();

    // If we got a new token, save it
    if (tokenResult.token && tokenResult.token !== user.access_token) {
      const expiresAt = Date.now() + 3600 * 1000; // Assume 1 hour
      await db.run(
        `UPDATE users SET access_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tokenResult.token, expiresAt, userId],
      );
      return tokenResult.token;
    }

    return user.access_token;
  } catch {
    // Token validation failed, try to force refresh
    try {
      const { accessToken } = await doTokenRefresh(userId, user.refresh_token);
      return accessToken;
    } catch (refreshError: unknown) {
      console.error(
        'Token refresh failed:',
        refreshError instanceof Error ? refreshError.message : refreshError,
      );
      throw new Error(
        'Token refresh failed. Please log out and log back in to re-authenticate with Google.',
      );
    }
  }
}

/**
 * Force refresh the token for a user.
 * Call this when you get a 401 error from Google API.
 */
export async function forceRefreshToken(userId: number): Promise<string> {
  const db = await getDatabase();
  const user = await db.get('SELECT refresh_token FROM users WHERE id = ?', [
    userId,
  ]);

  if (!user?.refresh_token) {
    throw new Error(
      'No refresh token available. Please log out and log back in.',
    );
  }

  const { accessToken } = await doTokenRefresh(userId, user.refresh_token);
  return accessToken;
}

/**
 * Save token expiry time when tokens are first obtained (during OAuth callback).
 * Call this from the passport callback after getting tokens.
 */
export async function saveTokenExpiry(
  userId: number,
  expiryDate?: number,
): Promise<void> {
  const db = await getDatabase();
  const expiresAt = expiryDate || Date.now() + 3600 * 1000; // Default 1 hour

  await db.run(`UPDATE users SET token_expires_at = ? WHERE id = ?`, [
    expiresAt,
    userId,
  ]);
}

/**
 * Get a valid access token directly from stored tokens (without user lookup).
 * Used when we already have the access_token and refresh_token from a query.
 */
export async function refreshAccessTokenIfNeeded(
  accessToken: string,
  refreshToken: string | null,
  userId: number,
): Promise<string> {
  if (!refreshToken) {
    return accessToken; // No refresh token, just use what we have
  }

  try {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Try to get token
    const tokenInfo = await oauth2Client.getAccessToken();
    if (tokenInfo.token) {
      // Save new token if it changed
      if (tokenInfo.token !== accessToken) {
        const db = await getDatabase();
        const expiresAt = Date.now() + 3600 * 1000;
        await db.run(
          `UPDATE users SET access_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [tokenInfo.token, expiresAt, userId],
        );
      }
      return tokenInfo.token;
    }
    return accessToken;
  } catch {
    // Token expired, try to refresh
    try {
      const { accessToken: newToken } = await doTokenRefresh(
        userId,
        refreshToken,
      );
      return newToken;
    } catch (refreshError: unknown) {
      console.error(
        'Failed to refresh token:',
        refreshError instanceof Error ? refreshError.message : refreshError,
      );
      throw new Error('Token refresh failed. Please log out and log back in.');
    }
  }
}

/**
 * Create an OAuth2 client with valid credentials for a user.
 * This handles token refresh automatically.
 */
export async function getAuthenticatedClient(userId: number) {
  const accessToken = await getValidAccessToken(userId);

  const db = await getDatabase();
  const user = await db.get('SELECT refresh_token FROM users WHERE id = ?', [
    userId,
  ]);

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getGoogleCallbackUrl(),
  );

  client.setCredentials({
    access_token: accessToken,
    refresh_token: user?.refresh_token,
  });

  return client;
}

/**
 * Execute a Google API call with automatic retry on 401 errors.
 * This will refresh the token and retry the call once.
 */
export async function withTokenRefresh<T>(
  userId: number,
  apiCall: (accessToken: string) => Promise<T>,
): Promise<T> {
  // Get current valid token
  let accessToken = await getValidAccessToken(userId);

  try {
    return await apiCall(accessToken);
  } catch (error: unknown) {
    // Check if it's a 401 error (unauthorized/token expired)
    const err = error as {
      code?: number;
      status?: number;
      response?: { status?: number };
    };
    const status = err?.code || err?.status || err?.response?.status;

    if (status === 401) {
      // Force refresh the token and retry
      try {
        accessToken = await forceRefreshToken(userId);
        return await apiCall(accessToken);
      } catch (retryError: unknown) {
        console.error(
          'API call failed after token refresh:',
          retryError instanceof Error ? retryError.message : retryError,
        );
        throw retryError;
      }
    }

    // Not a token error, rethrow
    throw error;
  }
}
