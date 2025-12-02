import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { getDatabase } from '../database/connection';

export function setupPassport() {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
        scope: [
          'profile',
          'email',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/spreadsheets'
        ]
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const db = await getDatabase();
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;
          const googleId = profile.id;

          // Check if user exists
          let user = await db.get(
            'SELECT * FROM users WHERE google_id = ?',
            [googleId]
          );

          if (!user) {
            // Create new user
            const result = await db.run(
              `INSERT INTO users (google_id, email, name, access_token, refresh_token) 
               VALUES (?, ?, ?, ?, ?)`,
              [googleId, email, name, accessToken, refreshToken]
            );
            user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
          } else {
            // Update tokens
            await db.run(
              `UPDATE users SET access_token = ?, refresh_token = ?, name = ?, email = ? 
               WHERE google_id = ?`,
              [accessToken, refreshToken || user.refresh_token, name, email, googleId]
            );
            user.access_token = accessToken;
            user.refresh_token = refreshToken || user.refresh_token;
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );

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

