import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { getDatabase } from '../database/connection';

// Allowed email domains for admin access
// Set via ALLOWED_EMAIL_DOMAINS env var (comma-separated) or defaults to kipr.org
function getAllowedDomains(): string[] {
  const envDomains = process.env.ALLOWED_EMAIL_DOMAINS;
  if (envDomains) {
    return envDomains.split(',').map((d) => d.trim().toLowerCase());
  }
  // Default to KIPR organization
  return ['kipr.org'];
}

function isEmailAllowed(email: string | undefined): boolean {
  if (!email) return false;

  const allowedDomains = getAllowedDomains();

  // If no domains are configured (empty string in env), allow all
  if (
    allowedDomains.length === 0 ||
    (allowedDomains.length === 1 && allowedDomains[0] === '')
  ) {
    return true;
  }

  const emailDomain = email.split('@')[1]?.toLowerCase();
  return allowedDomains.includes(emailDomain);
}

export function setupPassport() {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL ||
          'http://localhost:3000/auth/google/callback',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (
        accessToken: string,
        refreshToken: string,
        profile: any,
        done: any,
      ) => {
        try {
          const db = await getDatabase();
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;
          const googleId = profile.id;

          // Log if we got a refresh token (for debugging)
          if (!refreshToken) {
            console.warn(
              `Warning: No refresh token received for ${email}. User may need to revoke and re-authorize.`,
            );
          }

          // Check if email domain is allowed
          if (!isEmailAllowed(email)) {
            console.log(
              `Access denied for email: ${email} (not in allowed domains: ${getAllowedDomains().join(', ')})`,
            );
            return done(null, false, {
              message: `Access denied. Only ${getAllowedDomains().join(', ')} email addresses are allowed.`,
            });
          }

          // Check if user exists
          let user = await db.get('SELECT * FROM users WHERE google_id = ?', [
            googleId,
          ]);

          // Token expires in 1 hour (standard Google OAuth)
          const tokenExpiresAt = Date.now() + 3600 * 1000;

          if (!user) {
            // Create new user - set is_admin = true since they passed the domain check
            const result = await db.run(
              `INSERT INTO users (google_id, email, name, access_token, refresh_token, is_admin, token_expires_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                googleId,
                email,
                name,
                accessToken,
                refreshToken,
                true,
                tokenExpiresAt,
              ],
            );
            user = await db.get('SELECT * FROM users WHERE id = ?', [
              result.lastID,
            ]);
            console.log(`New admin user created: ${email}`);
          } else {
            // Update tokens and ensure is_admin is set (fix for existing users)
            await db.run(
              `UPDATE users SET access_token = ?, refresh_token = ?, name = ?, email = ?, is_admin = ?, token_expires_at = ?
               WHERE google_id = ?`,
              [
                accessToken,
                refreshToken || user.refresh_token,
                name,
                email,
                true,
                tokenExpiresAt,
                googleId,
              ],
            );
            user.access_token = accessToken;
            user.refresh_token = refreshToken || user.refresh_token;
            user.is_admin = true;
            console.log(`Admin user logged in: ${email}`);
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const db = await getDatabase();
      const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}
