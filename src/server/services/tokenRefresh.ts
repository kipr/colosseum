import { google } from 'googleapis';
import { getDatabase } from '../database/connection';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

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

  // Log token status for debugging
  const hasRefreshToken = !!user.refresh_token;
  console.log(`[TokenRefresh] User ${userId} (${user.email}): hasRefreshToken=${hasRefreshToken}`);

  // Try to use the current access token first by making a simple validation call
  try {
    oauth2Client.setCredentials({
      access_token: user.access_token,
      refresh_token: user.refresh_token
    });

    // Try to get token info - if it fails, token is expired
    const tokenResult = await oauth2Client.getAccessToken();
    
    // Check if we got a refreshed token
    if (tokenResult.token && tokenResult.token !== user.access_token) {
      console.log(`[TokenRefresh] Token was automatically refreshed for user ${userId}`);
      // Save the new token
      await db.run(
        `UPDATE users SET access_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tokenResult.token, userId]
      );
      return tokenResult.token;
    }
    
    // If we get here, the token is still valid
    return user.access_token;
  } catch (error: any) {
    console.log(`[TokenRefresh] Access token check failed for user ${userId}: ${error.message}`);
    
    // Token is likely expired, try to refresh it
    if (user.refresh_token) {
      try {
        console.log(`[TokenRefresh] Attempting to refresh token for user ${userId}...`);
        
        oauth2Client.setCredentials({
          refresh_token: user.refresh_token
        });

        const { credentials } = await oauth2Client.refreshAccessToken();
        const newAccessToken = credentials.access_token;
        const newRefreshToken = credentials.refresh_token;

        if (!newAccessToken) {
          throw new Error('Failed to get new access token from Google');
        }

        // Update the database with the new token(s)
        await db.run(
          `UPDATE users SET access_token = ?, refresh_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [newAccessToken, newRefreshToken || user.refresh_token, userId]
        );

        console.log(`[TokenRefresh] Successfully refreshed access token for user ${userId}`);
        return newAccessToken;
      } catch (refreshError: any) {
        console.error(`[TokenRefresh] Failed to refresh token for user ${userId}:`, refreshError.message);
        throw new Error('Token refresh failed. Please log out and log back in to re-authenticate with Google.');
      }
    } else {
      console.error(`[TokenRefresh] No refresh token for user ${userId}. User needs to re-authenticate.`);
      throw new Error('No refresh token available. Please log out and log back in to get a new refresh token.');
    }
  }
}

/**
 * Get a valid access token directly from stored tokens (without user lookup).
 * Used when we already have the access_token and refresh_token from a query.
 */
export async function refreshAccessTokenIfNeeded(
  accessToken: string,
  refreshToken: string | null,
  userId: number
): Promise<string> {
  try {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken || undefined
    });

    // Try to use current token
    const tokenInfo = await oauth2Client.getAccessToken();
    if (tokenInfo.token) {
      return tokenInfo.token;
    }
    return accessToken;
  } catch (error: any) {
    // Token expired, try to refresh
    if (refreshToken) {
      try {
        console.log(`Access token expired, refreshing for user ${userId}...`);
        
        oauth2Client.setCredentials({
          refresh_token: refreshToken
        });

        const { credentials } = await oauth2Client.refreshAccessToken();
        const newAccessToken = credentials.access_token;
        const newRefreshToken = credentials.refresh_token;

        if (!newAccessToken) {
          throw new Error('Failed to get new access token');
        }

        // Update the database
        const db = await getDatabase();
        await db.run(
          `UPDATE users SET access_token = ?, refresh_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [newAccessToken, newRefreshToken || refreshToken, userId]
        );

        console.log(`Successfully refreshed access token for user ${userId}`);
        return newAccessToken;
      } catch (refreshError: any) {
        console.error('Failed to refresh token:', refreshError.message);
        throw new Error('Token refresh failed. Please log out and log back in.');
      }
    } else {
      throw new Error('No refresh token. Please log out and log back in.');
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
  const user = await db.get('SELECT refresh_token FROM users WHERE id = ?', [userId]);
  
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  
  client.setCredentials({
    access_token: accessToken,
    refresh_token: user?.refresh_token
  });
  
  return client;
}

