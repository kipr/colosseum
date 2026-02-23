# Colosseum - Tournament Scoring Platform

A web-based tournament management and scoring platform with event-centric workflows, supporting seeding rounds, double-elimination brackets, game queues, and customizable score sheet templates.

## Features

- **Event Management** - Create and manage tournament events with statuses (setup, active, complete, archived)
- **Team Management** - Register teams, bulk import, check-in workflows, and status tracking
- **Seeding Rounds** - Multi-round seeding with automatic ranking calculation (top 2 of 3 scores)
- **Double Elimination Brackets** - Generate brackets (4-64 teams), automatic seeding from rankings, bye handling, and winner advancement
- **Game Queue** - Ordered queue system for seeding rounds and bracket games with table assignments
- **Customizable Score Sheets** - Template-driven scoring with text, number, dropdown, button, and checkbox field types
- **Score Review System** - Admins can accept, reject, or edit submitted scores with full audit trail
- **Access Codes** - Judges access scoresheets via secure access codes (no login required)
- **Google OAuth Authentication** - Secure admin login with Google accounts
- **Modern UI** - Responsive React interface with dark mode support
- **Public Views** - Public event listings and bracket/seeding displays

## Supported Field Types

Score sheet templates support the following field types:

- **Text** - Free-form text input
- **Number** - Numeric input with min/max/step validation
- **Dropdown** - Select from predefined options
- **Buttons** - Multiple choice with visual button selection
- **Checkbox** - Boolean (true/false) values

See [Template Schema Guide](docs/TEMPLATE_SCHEMA_GUIDE.md) for detailed schema documentation.

## Prerequisites

- Node.js 16+ and npm
- Google Cloud Platform account with OAuth 2.0 credentials (for admin authentication)

## Setup Instructions

### 1. Clone and Install

```bash
cd colosseum
npm install
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Create OAuth 2.0 credentials:
   - Go to "Credentials" -> "Create Credentials" -> "OAuth 2.0 Client ID"
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
4. Copy the Client ID and Client Secret

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` and add your Google OAuth credentials:

```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
SESSION_SECRET=your-random-session-secret
```

### 4. Run the Application

**Development mode (runs both React + Express):**

```bash
npm run dev
```

This starts two servers:

- **Vite dev server** (React frontend): `http://localhost:5173` - **Open this URL in your browser**
- **Express API server** (Backend): `http://localhost:3000`

The Vite server proxies API calls to Express automatically.

**Production mode:**

```bash
npm run build
npm start
```

In production, Express serves the built React app at `http://localhost:3000`.

**Important**: During development, always use `http://localhost:5173` (Vite) for the frontend, NOT port 3000.

## Usage Guide

### Tournament Workflow

A typical tournament follows this workflow:

1. **Create Event** - Admin creates a new event with name, date, location, and number of seeding rounds
2. **Register Teams** - Add teams individually or via bulk import
3. **Check In Teams** - Mark teams as checked in on competition day
4. **Run Seeding Rounds** - Queue seeding rounds, judges score via access codes, admin reviews scores
5. **Calculate Rankings** - System computes rankings from top 2 of 3 seeding scores
6. **Generate Brackets** - Create double-elimination brackets seeded from rankings
7. **Run Bracket Games** - Queue bracket games, judges score, admin reviews, winners advance automatically
8. **Complete Event** - Archive the event when the tournament concludes

### For Judges

1. Navigate to the home page
2. Click "Enter as Judge"
3. Select a score sheet template
4. Enter the access code provided by the admin
5. Fill out the scoresheet and submit

### For Administrators

1. **Login** with Google OAuth
2. **Create an Event** in the Events tab
3. **Add Teams** in the Teams tab (single or bulk import)
4. **Configure Score Sheets** in the Score Sheets tab
5. **Manage Seeding** - View scores, calculate rankings in the Seeding tab
6. **Create Brackets** - Generate brackets from seeding in the Brackets tab
7. **Manage Queue** - Populate and order the game queue in the Queue tab
8. **Review Scores** - Accept, reject, or edit scores in the Scoring tab

## Project Structure

```
colosseum/
├── src/
│   ├── client/                    # React frontend
│   │   ├── components/            # Reusable React components
│   │   │   ├── admin/             # Admin panel tabs and modals
│   │   │   ├── bracket/           # Bracket visualization components
│   │   │   └── seeding/           # Seeding table components
│   │   ├── contexts/              # React contexts (Auth, Theme, Event, Chat)
│   │   ├── pages/                 # Page components (Home, Judge, Admin, etc.)
│   │   ├── styles/                # Global styles
│   │   ├── types/                 # TypeScript type definitions
│   │   ├── utils/                 # Utility functions
│   │   ├── App.tsx                # Main React app with routing
│   │   └── main.tsx               # React entry point
│   └── server/                    # Express backend
│       ├── config/                # OAuth and API configuration
│       ├── database/              # Database connection and schema initialization
│       ├── middleware/            # Authentication middleware
│       ├── routes/                # API route handlers
│       │   ├── auth.ts            # Authentication routes
│       │   ├── events.ts          # Event CRUD
│       │   ├── teams.ts           # Team management
│       │   ├── seeding.ts         # Seeding scores and rankings
│       │   ├── brackets.ts        # Bracket management
│       │   ├── queue.ts           # Game queue
│       │   ├── scores.ts          # Score review/approval
│       │   ├── scoresheet.ts      # Template management
│       │   ├── audit.ts           # Audit log
│       │   └── api.ts             # Score submission (judge-facing)
│       ├── services/              # Business logic
│       │   ├── seedingRankings.ts  # Seeding calculation
│       │   ├── bracketTemplates.ts # Bracket structure generation
│       │   ├── bracketByeResolver.ts # Bye handling
│       │   └── scoreAccept.ts      # Score acceptance logic
│       ├── session/               # Session store
│       └── server.ts              # Express server setup
├── docs/                          # Documentation
│   ├── TEMPLATE_SCHEMA_GUIDE.md   # Score sheet template schema reference
│   └── API_TESTING.md             # API testing guide with curl examples
├── templates/                     # Example score sheet templates
├── tests/                         # Test suite
├── database/                      # SQLite databases (auto-created)
├── dist/                          # Build output
├── vite.config.ts                 # Vite configuration
├── tsconfig.json                  # TypeScript config
├── package.json
├── Dockerfile                     # Production Docker image
└── .env                           # Environment variables (not committed)
```

## Database Schema

The application uses SQLite (development) or PostgreSQL (production) with the following tables:

### Core Tables

- **users** - User accounts and OAuth tokens
- **events** - Tournament events with status tracking
- **teams** - Participating teams per event with check-in status
- **scoresheet_templates** - Score sheet template definitions

### Seeding

- **seeding_scores** - Individual round scores per team
- **seeding_rankings** - Computed rankings (seed average, rank, normalized score)

### Brackets

- **brackets** - Double-elimination bracket containers
- **bracket_entries** - Teams assigned to brackets with seed positions
- **bracket_games** - Individual games with advancement routing
- **bracket_templates** - Pre-defined bracket structures for standard sizes

### Scoring

- **score_submissions** - Submitted scores with review status
- **score_details** - Field-by-field score breakdown
- **event_scoresheet_templates** - Links templates to events for seeding/bracket scoring

### Operations

- **game_queue** - Ordered queue of games ready for judging
- **audit_log** - Change tracking for accountability

## API Endpoints

### Authentication

- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/user` - Get current user
- `GET /auth/logout` - Logout

### Events

- `GET /events` - List all events
- `GET /events/:id` - Get event details
- `POST /events` - Create event
- `PATCH /events/:id` - Update event
- `DELETE /events/:id` - Delete event

### Teams

- `GET /teams/event/:eventId` - List teams for event
- `GET /teams/:id` - Get team details
- `POST /teams` - Create team
- `POST /teams/bulk` - Bulk create teams
- `PATCH /teams/:id` - Update team
- `PATCH /teams/:id/check-in` - Check in team
- `DELETE /teams/:id` - Delete team

### Seeding

- `GET /seeding/scores/event/:eventId` - Get all scores for event
- `GET /seeding/scores/team/:teamId` - Get scores for team
- `POST /seeding/scores` - Submit seeding score
- `PATCH /seeding/scores/:id` - Update score
- `DELETE /seeding/scores/:id` - Delete score
- `GET /seeding/rankings/event/:eventId` - Get rankings
- `POST /seeding/rankings/recalculate/:eventId` - Recalculate rankings

### Brackets

- `GET /brackets/event/:eventId` - List brackets for event
- `GET /brackets/:id` - Get bracket with entries and games
- `POST /brackets` - Create bracket
- `PATCH /brackets/:id` - Update bracket
- `DELETE /brackets/:id` - Delete bracket
- `POST /brackets/:id/entries` - Add entry
- `POST /brackets/:id/entries/generate` - Generate entries from seeding
- `GET /brackets/:id/games` - Get games
- `POST /brackets/:id/games` - Create game
- `PATCH /brackets/games/:id` - Update game
- `POST /brackets/games/:id/advance` - Advance winner

### Queue

- `GET /queue/event/:eventId` - Get queue for event
- `POST /queue` - Add item to queue
- `PATCH /queue/:id` - Update queue item
- `PATCH /queue/:id/call` - Call team/game
- `POST /queue/reorder` - Reorder queue
- `DELETE /queue/:id` - Remove from queue

### Scoring

- `POST /api/scores/submit` - Submit a score (judge-facing)
- `GET /scores/by-event/:eventId` - Get scores for event (admin)
- `POST /scores/:id/accept-event` - Accept score (event-scoped)
- `POST /scores/:id/revert-event` - Revert acceptance

### Templates

- `GET /scoresheet/templates` - List all templates
- `GET /scoresheet/templates/:id` - Get template details
- `POST /scoresheet/templates` - Create template
- `PUT /scoresheet/templates/:id` - Update template

### Audit

- `GET /audit/event/:eventId` - Get audit log for event
- `GET /audit/entity/:type/:id` - Get audit log for entity

## Development

### Tech Stack

- **Frontend**: React 19, TypeScript, React Router, Vite
- **Backend**: Node.js, Express 5, TypeScript
- **Database**: SQLite (dev) / PostgreSQL (production)
- **Authentication**: Passport.js with Google OAuth 2.0
- **Testing**: Vitest
- **Build Tools**: Vite (frontend), TypeScript Compiler (backend)

### Building

```bash
npm run build
```

Builds both React frontend and Express backend:

- React app -> `dist/client/`
- Express server -> `dist/server/`

### Development Servers

```bash
npm run dev
```

Runs both servers concurrently:

- **Vite** (React with HMR): http://localhost:5173 - **Use this for development**
- **Express** (API): http://localhost:3000

Changes to React components update instantly (Hot Module Replacement).
Changes to Express server restart automatically (nodemon).

**Individual servers:**

```bash
npm run dev:client  # Vite only
npm run dev:server  # Express only
```

### Testing

```bash
npm test           # Run tests in watch mode
npm run test:run   # Run tests once
npm run coverage   # Run with coverage report
```

### Linting and Formatting

```bash
npm run lint       # ESLint
npm run pretty     # Prettier check
```

## Troubleshooting

### "Authentication required" errors

- Ensure you're logged in with Google
- Check that OAuth credentials are correctly configured
- Verify redirect URI matches in Google Cloud Console

### Teams not appearing

- Verify the event is selected in the admin panel
- Check that teams have been added to the correct event
- Ensure team status is not "withdrawn" or "no_show"

### Bracket generation issues

- Ensure seeding rankings have been calculated first
- Verify the bracket size accommodates the number of teams
- Check that teams are checked in before generating entries

### Scores not updating rankings

- Rankings must be recalculated manually after score changes
- Use the "Recalculate Rankings" button in the Seeding tab
- a

## License

ISC
