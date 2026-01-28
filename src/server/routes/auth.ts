import express, { Request, Response } from 'express';
import passport from 'passport';

const router = express.Router();

// Initiate Google OAuth
// Note: accessType and prompt must be passed exactly as Google expects
router.get('/google', (req, res, next) => {
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
    // These ensure we get a refresh token that lasts longer
    accessType: 'offline',
    prompt: 'consent', // Forces re-consent to ensure we get a fresh refresh token
    includeGrantedScopes: true,
  } as any)(req, res, next);
});

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/access-denied',
    failureMessage: true,
  }),
  (req: Request, res: Response) => {
    // Ensure session is saved before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session save failed');
      }

      // Redirect to root with a query param so frontend knows to go to admin
      // Don't redirect to /admin as it conflicts with the API route
      // Use APP_URL to redirect to custom domain in production
      const isDev = process.env.NODE_ENV !== 'production';
      const baseUrl = isDev
        ? 'http://localhost:5173'
        : process.env.APP_URL || '';
      res.redirect(`${baseUrl}/?logged_in=1`);
    });
  },
);

// Access denied page for unauthorized users
router.get('/access-denied', (req: Request, res: Response) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const baseUrl = isDev ? 'http://localhost:5173' : process.env.APP_URL || '';

  // Get allowed domains from environment or default
  const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS
    ? process.env.ALLOWED_EMAIL_DOMAINS.split(',').map((d) => d.trim())
    : ['kipr.org'];

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Access Denied - Colosseum</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: #f8fafc;
        }
        .container {
          text-align: center;
          padding: 2rem;
          max-width: 500px;
        }
        h1 { color: #ef4444; margin-bottom: 1rem; }
        p { color: #64748b; margin-bottom: 1.5rem; line-height: 1.6; }
        .domains { 
          background: #f1f5f9; 
          padding: 1rem; 
          border-radius: 0.5rem;
          margin-bottom: 1.5rem;
          font-family: monospace;
        }
        a {
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: #2563eb;
          color: white;
          text-decoration: none;
          border-radius: 0.375rem;
          font-weight: 500;
        }
        a:hover { background: #1d4ed8; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚫 Access Denied</h1>
        <p>
          Sorry, your email address is not authorized to access the admin area.
          Only members of the KIPR organization can log in as administrators.
        </p>
        <div class="domains">
          Allowed domains: ${allowedDomains.join(', ')}
        </div>
        <p>
          If you believe you should have access, please contact your organization administrator.
        </p>
        <a href="${baseUrl}/">Return to Home</a>
      </div>
    </body>
    </html>
  `);
});

// Logout
router.get('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }

    // Also destroy the session to ensure complete logout
    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        console.error('Session destroy error:', sessionErr);
      }

      // Clear the session cookie
      res.clearCookie('connect.sid');

      // In development, redirect to Vite dev server
      // Use APP_URL for custom domain in production
      const isDev = process.env.NODE_ENV !== 'production';
      const baseUrl = isDev
        ? 'http://localhost:5173'
        : process.env.APP_URL || '';
      res.redirect(`${baseUrl}/`);
    });
  });
});

// Get current user
router.get('/user', (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    const user = req.user as any;
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.is_admin,
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Check if current user's tokens are valid (for admin notification)
router.get('/check-tokens', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = req.user as any;

  try {
    // Import the token refresh function
    const { getValidAccessToken } = await import('../services/tokenRefresh');

    // Try to get a valid token - this will refresh if needed
    await getValidAccessToken(user.id);

    res.json({
      valid: true,
      message: 'Tokens are valid',
    });
  } catch (error: any) {
    console.error('Token check failed:', error.message);
    res.json({
      valid: false,
      message: error.message,
      needsReauth: true,
    });
  }
});

export default router;
