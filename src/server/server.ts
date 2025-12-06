// Load environment variables FIRST, before any other imports
// This ensures all modules have access to env vars when they initialize
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
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

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

// Trust Cloud Run's load balancer
if (isProduction) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'colosseum-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction, // Trust the reverse proxy (Cloud Run)
  cookie: {
    secure: isProduction, // Require HTTPS in production
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
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
      createTableIfMissing: true
    });
    console.log('Using PostgreSQL session store');
  }
} else {
  // Use SQLite session store in development
  const SQLiteStore = connectSqlite3(session);
  sessionConfig.store = new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '../../database')
  }) as any;
  console.log('Using SQLite session store');
}

app.use(session(sessionConfig));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());
setupPassport();

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

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In production, serve React app for all non-API routes
if (process.env.NODE_ENV === 'production') {
  // Express 5 requires named parameter for wildcards
  app.get('/{*path}', (req: Request, res: Response) => {
    // Don't serve React for API routes
    if (!req.path.startsWith('/api') && !req.path.startsWith('/auth') && 
        !req.path.startsWith('/admin') && !req.path.startsWith('/scoresheet') &&
        !req.path.startsWith('/data') && !req.path.startsWith('/scores') &&
        !req.path.startsWith('/chat') && !req.path.startsWith('/field-templates')) {
      res.sendFile(path.join(__dirname, '../client/index.html'));
    }
  });
}

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
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
        hour12: true
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

