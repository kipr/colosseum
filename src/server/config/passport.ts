import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from 'passport-google-oauth20';
import { getDatabase } from '../database/connection';
import { getGoogleCallbackUrl } from './google';

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
        callbackURL: getGoogleCallbackUrl(),
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => {
        try {
          const db = await getDatabase();
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;
          const googleId = profile.id;

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

          if (!user) {
            // Create new user - set is_admin = true since they passed the domain check
            const result = await db.run(
              `INSERT INTO users (google_id, email, name, is_admin)
               VALUES (?, ?, ?, ?) RETURNING id`,
              [googleId, email, name, true],
            );
            user = await db.get('SELECT * FROM users WHERE id = ?', [
              result.lastID,
            ]);
            console.log(`New admin user created: ${email}`);
          } else {
            // Keep the user's Google identity current and ensure admin access.
            await db.run(
              `UPDATE users SET name = ?, email = ?, is_admin = ?
               WHERE google_id = ?`,
              [name, email, true, googleId],
            );
            user.name = name;
            user.email = email;
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
