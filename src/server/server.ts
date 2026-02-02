// Load environment variables FIRST, before any other imports
// This ensures all modules have access to env vars when they initialize
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import BetterSqlite3 from "better-sqlite3";
import { SqliteSessionStore } from "./session/SqliteSessionStore";
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import cors from 'cors';
import path from 'path';
import { setupPassport } from './config/passport';
import { initializeDatabase } from './database/init';
import { getPostgresPool } from './database/connection';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import scoresheetRoutes from './routes/scoresheet';
import fieldTemplatesRoutes from './routes/fieldTemplates';
import apiRoutes from './routes/api';
import dataRoutes from './routes/data';
import scoresRoutes from './routes/scores';
import chatRoutes from './routes/chat';
import eventsRoutes from './routes/events';
import teamsRoutes from './routes/teams';
import seedingRoutes from './routes/seeding';
import bracketsRoutes from './routes/brackets';
import queueRoutes from './routes/queue';
import auditRoutes from './routes/audit';

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

// Trust Cloud Run's load balancer
if (isProduction) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  }),
);
// Increase body size limit to 10MB for image uploads (game areas images stored as base64)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
const sessionConfig: session.SessionOptions = {
  secret:
    process.env.SESSION_SECRET || 'colosseum-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction, // Trust the reverse proxy (Cloud Run)
  cookie: {
    secure: isProduction, // Require HTTPS in production
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

// Configure session store based on environment
if (usePostgres) {
  // Use PostgreSQL session store in production
  const PgSession = connectPgSimple(session);
  const pgPool = getPostgresPool();
  if (pgPool) {
    sessionConfig.store = new PgSession({
      pool: pgPool,
      tableName: 'session',
      createTableIfMissing: true,
    });
    console.log('Using PostgreSQL session store');
  }
} else {
  // Use SQLite session store in development (custom better-sqlite3 store)
  const dbPath = path.join(__dirname, "../../database", "sessions.db");

  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sessionConfig.store = new SqliteSessionStore({
    db: sqlite,
    tableName: "sessions",
    ttlMs: 7 * 24 * 60 * 60 * 1000, // keep in sync with cookie maxAge if you want
  }) as session.Store;

  console.log("Using SQLite session store (custom better-sqlite3)");
}
app.use(session(sessionConfig));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());
setupPassport();

// Activity tracking middleware - updates last_activity for authenticated users
interface UserWithActivity {
  id: number;
  _lastActivityUpdate?: number;
}
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated() && req.user) {
    const user = req.user as UserWithActivity;
    // Update last activity (throttled to once per minute to reduce DB writes)
    const now = Date.now();
    const lastUpdate = user._lastActivityUpdate || 0;
    if (now - lastUpdate > 60000) {
      // Only update once per minute
      user._lastActivityUpdate = now;
      try {
        const { getDatabase } = await import('./database/connection');
        const db = await getDatabase();
        await db.run(
          'UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
          [user.id],
        );
      } catch (error) {
        // Silently fail - don't break requests if activity tracking fails
        console.error('Failed to update last activity:', error);
      }
    }
  }
  next();
});

// Static files - serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client')));
} else {
  // In development, Vite serves the React app
  // Keep legacy HTML files for gradual migration
  app.use(express.static(path.join(__dirname, '../../public')));
}
app.use('/static', express.static(path.join(__dirname, '../../static')));
app.use('/images', express.static(path.join(__dirname, '../../static/images')));

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/scoresheet', scoresheetRoutes);
app.use('/field-templates', fieldTemplatesRoutes);
app.use('/api', apiRoutes);
app.use('/data', dataRoutes);
app.use('/scores', scoresRoutes);
app.use('/chat', chatRoutes);
app.use('/events', eventsRoutes);
app.use('/teams', teamsRoutes);
app.use('/seeding', seedingRoutes);
app.use('/brackets', bracketsRoutes);
app.use('/queue', queueRoutes);
app.use('/audit', auditRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In production, serve React app for all non-API routes
if (process.env.NODE_ENV === 'production') {
  // These are the React SPA routes - serve index.html for these exact paths
  const spaRoutes = ['/', '/admin', '/judge', '/scoresheet'];

  spaRoutes.forEach((route) => {
    app.get(route, (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../client/index.html'));
    });
  });

  // Catch-all for any other non-API routes (e.g., direct asset requests that miss static)
  app.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
    // Only serve React for paths that aren't handled by API routes
    const apiPrefixes = [
      '/api',
      '/auth/',
      '/admin/',
      '/scoresheet/',
      '/data/',
      '/scores/',
      '/chat/',
      '/field-templates/',
      '/events/',
      '/teams/',
      '/seeding/',
      '/brackets/',
      '/queue/',
      '/audit/',
    ];
    const isApiRoute = apiPrefixes.some((prefix) =>
      req.path.startsWith(prefix),
    );

    if (!isApiRoute) {
      res.sendFile(path.join(__dirname, '../client/index.html'));
    } else {
      // If it's an API route that wasn't matched, return 404
      next();
    }
  });
}

// Error handling middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res
    .status(500)
    .json({ error: 'Internal server error', message: err.message });
});

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      console.log(`\n🏛️  Colosseum server running on http://localhost:${PORT}`);
      console.log(`⏰  Server started at: ${timestamp}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
