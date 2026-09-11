# Colosseum - Tournament Scoring Platform

A web-based tournament management and scoring platform with event-centric workflows, supporting seeding and double-seeding rounds, double-elimination brackets, game queues, documentation scoring, awards, and customizable score sheet templates.

## Features

- **Event Management** - Create and manage tournament events with statuses (setup, active, complete, archived)
- **Team Management** - Register teams, bulk import, check-in workflows, and status tracking
- **Seeding Rounds** - Multi-round seeding with automatic ranking calculation (top 2 of 3 scores)
- **Double Seeding** - Randomized paired or solo matches with independent rankings and spectator views
- **Double Elimination Brackets** - Generate brackets (4-64 teams), automatic seeding from rankings, bye handling, and winner advancement
- **Game Queue** - Ordered queue for seeding, double-seeding, and bracket games with table assignments, per-team arrival tracking, and rest warnings
- **Customizable Score Sheets** - Template-driven scoring with text, number, dropdown, button, checkbox, and repeatable group field types
- **Score Review System** - Admins can accept, reject, or edit submitted scores with full audit trail
- **Access Codes** - Judges access scoresheets via secure access codes (no login required)
- **Judge Chat** - Event-scoped judge-to-admin conversations
- **Documentation and Awards** - Weighted documentation scoring, manual awards, and automatic placements
- **Google OAuth Authentication** - Secure admin login with Google accounts
- **Modern UI** - Responsive React interface with dark mode support
- **Public Views** - Public event listings, live competition views, released standings, and awards

## Supported Field Types

Score sheet templates support the following field types:

- **Text** - Free-form text input
- **Number** - Numeric input with min/max/step validation
- **Dropdown** - Select from predefined options
- **Buttons** - Multiple choice with visual button selection
- **Checkbox** - Boolean (true/false) values
- **Repeatable Group** - Repeatable rows of sub-fields (for example, per-stack cube entry)
- **Calculated** - Read-only totals evaluated by the shared formula engine
- **Section/Group Headers** - Layout-only labels for organizing a sheet
- **Winner Select** - Match-winner selection for head-to-head sheets

See [Template Schema Guide](docs/TEMPLATE_SCHEMA_GUIDE.md) for detailed schema documentation.
Formula syntax is documented in [Formula Engine](docs/formula-engine.md).

> **Note:** Templates that include `repeatableGroup` fields are not portable yet. They cannot be exported with the [portable scoresheet tool](tools/portable-scoresheet/README.md) until portable exporter support for this field type is added.

## Prerequisites

- Node.js 24 LTS and npm 11
- Google Cloud Platform account with OAuth 2.0 credentials (only for admin authentication)
- Docker Engine + Compose (required; local PostgreSQL 18)

## Setup Instructions

### 1. Clone and Install

```bash
cd colosseum
npm install
```

### 2. Configure Google OAuth

This step is optional when you only need public/spectator pages or judge-facing
access-code scoring. It is required for the admin interface.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Create OAuth 2.0 credentials:
   - Go to "Credentials" -> "Create Credentials" -> "OAuth 2.0 Client ID"
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
4. Copy the Client ID and Client Secret

By default, only `@kipr.org` addresses may log in. Set
`ALLOWED_EMAIL_DOMAINS=` to allow any domain, or provide a comma-separated list
of allowed domains.

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` and add your Google OAuth credentials:

```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
SESSION_SECRET=your-random-session-secret
DATABASE_URL=postgres://colosseum:colosseum@localhost:5432/colosseum
TEST_DATABASE_URL=postgres://colosseum:colosseum@localhost:5432/colosseum_test
```

`.env.example` already includes those database URLs. Inside a devcontainer the hostname is `postgres` rather than `localhost`.

### 4. Start PostgreSQL

Do not auto-start Compose from `npm run dev`. Start it first:

```bash
npm run db:up && npm run db:wait
```

**Port 5432 already in use.** Create `docker-compose.override.yml` (gitignored if you prefer; do not commit local port choices):

```yaml
services:
  postgres:
    ports:
      - '5433:5432'
```

Point `DATABASE_URL` and `TEST_DATABASE_URL` at `localhost:5433`.

**Wipe local Postgres data:**

```bash
npm run db:reset
```

Helper scripts: `db:up`, `db:wait`, `db:down`, `db:reset`, `db:psql`.

**Devcontainer / Codespaces.** Reopening the folder in a container starts Compose siblings (`app` + `postgres`) with `DATABASE_URL` already pointing at hostname `postgres`. Wait for `postStartCommand` (`pg_isready`) before `npm run dev`.

### 5. Run the Application

**Dev servers (React + Express):**

```bash
npm run dev
```

This starts two servers:

- **Vite dev server** (React frontend): `http://localhost:5173` - **Open this URL in your browser**
- **Express API server** (Backend): `http://localhost:3000`

The Vite server proxies API calls to Express automatically.

Expect these logs:

```
Using PostgreSQL session store
Using PostgreSQL database
Database initialized successfully
```

Confirm the API is up:

```bash
curl http://localhost:3000/health
```

Should return `{ "status": "ok", ... }`.

Inspect databases and schema:

```bash
npm run db:psql
```

Then in `psql`:

```
\l
\c colosseum
\dt
```

`\l` should list both `colosseum` and `colosseum_test`. `\dt` should show application tables plus `"session"` after the first server start (the session table is created by `connect-pg-simple`).

**Production mode:**

```bash
npm run build
npm start
```

In production, Express serves the built React app at `http://localhost:3000`.

**Important**: When running the Vite + Express pair, always use `http://localhost:5173` (Vite) for the frontend, NOT port 3000.

## Usage Guide

### Tournament Workflow

A typical tournament follows this workflow:

1. **Create Event** - Admin creates a new event with name, date, location, and number of seeding rounds
2. **Register Teams** - Add teams individually or via bulk import
3. **Check In Teams** - Mark teams as checked in on competition day
4. **Run Seeding Rounds** - Queue seeding rounds, judges score via access codes, admin reviews scores
5. **Run Double Seeding (optional)** - Generate paired matches, queue them, and review scores
6. **Calculate Rankings** - System computes seeding and optional double-seeding rankings
7. **Generate Brackets** - Create double-elimination brackets seeded from rankings
8. **Run Bracket Games** - Queue bracket games, judges score, admin reviews, winners advance automatically
9. **Score Documentation and Assign Awards** - Enter weighted documentation scores and prepare recipients
10. **Complete and Release** - Complete the event, release spectator results when ready, then archive it

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
5. **Manage Seeding** - View scores and rankings in the Seeding tab
6. **Manage Double Seeding** - Generate configured rounds when the event uses them
7. **Create Brackets** - Generate brackets from seeding in the Brackets tab
8. **Manage Queue** - Call teams, confirm arrivals, and assign tables in the Queue tab
9. **Review Scores** - Accept, reject, or edit scores in the Scoring tab
10. **Finish the Event** - Enter documentation scores, assign awards, and release final results

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
│   ├── server/                    # Express backend
│   │   ├── config/                # OAuth and API configuration
│   │   ├── database/              # Database connection and schema initialization
│   │   ├── middleware/            # Authentication middleware
│   │   ├── routes/                # API route handlers
│   │   │   ├── auth.ts            # Authentication routes
│   │   │   ├── events.ts          # Event CRUD
│   │   │   ├── teams.ts           # Team management
│   │   │   ├── seeding.ts         # Seeding scores and rankings
│   │   │   ├── brackets.ts        # Bracket management
│   │   │   ├── queue.ts           # Game queue
│   │   │   ├── scores.ts          # Score review/approval
│   │   │   ├── scoresheet.ts      # Template management
│   │   │   ├── audit.ts           # Audit log
│   │   │   └── api.ts             # Score submission (judge-facing)
│   │   ├── services/              # Business logic
│   │   │   ├── seedingRankings.ts  # Seeding calculation
│   │   │   ├── bracketTemplates.ts # Bracket structure generation
│   │   │   ├── bracketByeResolver.ts # Bye handling
│   │   │   └── scoreAccept.ts      # Score acceptance logic
│   │   └── server.ts              # Express server setup
│   └── shared/                    # Shared schema, formula, award, and parsing logic
├── docs/                          # Documentation
│   ├── README.md                   # Documentation index
│   ├── DATABASE.md                # Current PostgreSQL architecture
│   ├── TEMPLATE_SCHEMA_GUIDE.md   # Score sheet template schema reference
│   ├── API_TESTING.md             # API smoke tests and route catalog
│   └── legacy/                    # Superseded designs and completed plans
├── templates/                     # Example score sheet templates
├── tests/                         # Unit & integration tests (Vitest)
├── e2e/                           # End-to-end tests (Playwright)
├── config/                        # Shared test-runner configuration
├── docker/                        # Local Postgres init scripts
├── docker-compose.yml             # Local PostgreSQL 18 (required for app and tests)
├── dist/                          # Build output
├── playwright.config.ts           # Playwright E2E config
├── vite.config.ts                 # Vite configuration
├── tsconfig.json                  # TypeScript config
├── package.json
├── Dockerfile                     # Production Docker image
└── .env                           # Environment variables (not committed)
```

## Database Schema

The application uses PostgreSQL with the following tables:

### Core configuration

- **users** - User accounts and OAuth tokens
- **events** - Tournament events with status tracking
- **teams** - Participating teams per event with check-in status
- **scoresheet_templates** - Score sheet template definitions
- **scoresheet_field_templates** - Reusable groups of score fields
- **event_scoresheet_templates** - Event-to-template assignments

### Seeding

- **seeding_scores** - Individual round scores per team
- **seeding_rankings** - Computed rankings (seed average, rank, normalized score)
- **double_seeding_matches** - Paired and solo double-seeding matches
- **double_seeding_scores** - Per-team double-seeding results
- **double_seeding_rankings** - Double-seeding averages, ranks, and normalized scores

### Brackets

- **brackets** - Double-elimination bracket containers
- **bracket_entries** - Teams assigned to brackets with seed positions
- **bracket_games** - Individual games with advancement routing
- **bracket_templates** - Pre-defined bracket structures for standard sizes

### Scoring

- **score_submissions** - Submitted scores with review status
- **score_details** - Field-by-field score breakdown

### Documentation and awards

- **documentation_categories** / **event_documentation_categories** - Global categories and event assignments
- **documentation_scores** / **documentation_sub_scores** - Weighted team documentation results
- **award_templates** / **event_awards** - Award catalog and event awards
- **event_award_recipients** / **event_award_individual_recipients** - Team and individual recipients
- **event_automatic_award_settings** - Automatic placement configuration

### Operations

- **game_queue** - Ordered queue of games ready for judging
- **queue_versions** - Queue synchronization and ETag version state
- **audit_log** - Change tracking for accountability
- **judge_chat_messages** - Event-scoped judge/admin messages
- **active_sessions** - Application session-token records
- **session** - PostgreSQL-backed Express sessions

See [Database Architecture](docs/DATABASE.md) for the authoritative module and
table map. The executable schema lives in `src/server/database/schema/`.

## API

The API covers authentication, events, teams, seeding, double seeding,
brackets, queue management, score review, scoresheets, documentation scoring,
awards, audit history, and judge chat. Public reads, judge sessions,
authenticated routes, and admin-only routes have different access rules.

See [API Testing Guide](docs/API_TESTING.md) for startup instructions, curl
examples, and the current route catalog. Route handlers in
`src/server/routes/` remain authoritative.

## Working on the app

### Tech Stack

- **Frontend**: React 19, TypeScript, React Router, Vite
- **Backend**: Node.js, Express 5, TypeScript
- **Database**: PostgreSQL 18 (Docker Compose locally; Cloud SQL in production)
- **Authentication**: Passport.js with Google OAuth 2.0
- **Testing**: Vitest (unit/integration), Playwright (E2E)
- **Build Tools**: Vite (frontend), TypeScript Compiler (backend)

### Building

```bash
npm run build
```

Builds both React frontend and Express backend:

- React app -> `dist/client/`
- Express server -> `dist/server/`

### Dev Servers

```bash
npm run dev
```

Runs both servers concurrently:

- **Vite** (React with HMR): http://localhost:5173 - **Open this URL in your browser**
- **Express** (API): http://localhost:3000

Changes to React components update instantly (Hot Module Replacement).
Changes to Express server restart automatically (nodemon).

**Individual servers:**

```bash
npm run dev:client  # Vite only
npm run dev:server  # Express only
```

### Testing

**Unit & integration tests** (Vitest):

These run against PostgreSQL 18, the same major version as production, so the
tests exercise the dialect the application actually ships on. Start the server
first — `npm run db:up` also creates the `colosseum_test` database:

```bash
npm run db:up && npm run db:wait
npm test           # Run tests in watch mode
npm run test:run   # Run tests once
```

The connection string comes from `TEST_DATABASE_URL` (in your environment or
`.env`), and defaults to
`postgres://colosseum:colosseum@localhost:5432/colosseum_test`. Inside a
devcontainer the host is `postgres` rather than `localhost`.

Each Vitest worker process creates its own schema in that database and
truncates it between tests, so runs never touch your `colosseum` dev data.

**End-to-end tests** (Playwright):

Playwright tests live in the `e2e/` directory and run against the full
application. `npm run db:up` must have been run first.

The Playwright config (`playwright.config.ts`) starts its **own** Express on
port 3001 and Vite on port 5174, with `DATABASE_URL` set to
`TEST_DATABASE_URL`. It never reuses a server already listening on 3000/5173,
so you can leave `npm run dev` running while the suite executes and it will not
touch your dev data. The suite uses the `public` schema of `colosseum_test` and
truncates it once at the start of each run, which does not disturb the Vitest
suite's per-worker schemas on the same database.

Before your first run, you will need to download Playwright's headless browser builds and their required OS libraries.
This is not handled by `npm install`.

> [!NOTE]
> If you are using the [Devcontainer](https://docs.projectbluefin.io/devcontainers) setup, you do not need to run these commands manually.
> Simply go straight to `npm run test:e2e` below.

```bash
# First-time setup — download Chromium and install required OS libraries.
# If in an environment without sudo (e.g. container), install in two steps.
# First, run as root to install OS-level libraries and dependencies:
npx playwright install-deps

# Then, as your user, run:
npx playwright install

# If in an environment with sudo access, you can do this in one step with:
npx playwright install --with-deps
```

Once the dependencies are installed, run Playwright tests with:

```
# Run E2E tests
npm run test:e2e
```

### Linting and Formatting

```bash
npm run lint       # ESLint
npm run pretty     # Prettier check
```

## Rate Limiting

Public and abuse-prone API endpoints are protected by `express-rate-limit` with per-route policies defined in `src/server/middleware/rateLimit.ts`.

### Current Limits

| Limiter                      | Endpoints                                                   | Window | Limit | Key                     |
| ---------------------------- | ----------------------------------------------------------- | ------ | ----- | ----------------------- |
| `oauthLimiter`               | `GET /auth/google`                                          | 15 min | 20    | IP                      |
| `scoreSubmitLimiter`         | `POST /api/scores/submit`                                   | 1 min  | 30    | IP                      |
| `accessCodeLimiter`          | `POST /scoresheet/templates/:id/verify`                     | 15 min | 10    | IP + template id        |
| `chatWriteLimiter`           | `POST /chat/events/:eventId/messages`                       | 1 min  | 15    | IP                      |
| `chatReadLimiter`            | `GET /chat/events/:eventId/messages`                        | 1 min  | 120   | IP                      |
| `queueSyncLimiter`           | `GET /queue/event/:eventId` (sync=1 only)                   | 1 min  | 120   | IP + event + queue type |
| `publicExpensiveReadLimiter` | Released overall, documentation, and award result endpoints | 1 min  | 30    | IP                      |

### Storage Constraints

- Rate-limit counters use the built-in **in-process memory store**. This is a deliberate first-pass choice.
- Counters **reset on process restart** and are **not shared across workers or instances**.
- This is acceptable for a single-instance deployment or an initial rollout.

### When to Upgrade the Store

Move to a shared store (e.g. Redis via `rate-limit-redis`) when any of the following apply:

- The app runs on more than one instance (clustering, PM2 workers, Kubernetes replicas)
- Consistent global rate limits are required across restarts
- Stricter abuse controls are needed that survive deploys

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

## License

GNU AGPL v3
