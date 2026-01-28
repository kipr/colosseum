# 🏛️ Colosseum - Score Sheet Application

A powerful web-based scoring application with Google Sheets integration, supporting multiple concurrent users and customizable score sheet templates.

## Features

- 🔐 **Google OAuth Authentication** - Secure login with Google accounts
- 📊 **Google Sheets Integration** - Read participants/matches and submit scores directly to spreadsheets
- 📝 **Customizable Templates** - Create multiple score sheet templates with various field types
- 👥 **Multi-User Support** - Multiple users can score simultaneously
- 💾 **Local & Cloud Storage** - Scores saved locally (SQLite) and synced to Google Sheets
- 🎨 **Modern UI** - Clean, responsive React interface with dark mode support
- 🏆 **Score Review System** - Admins can accept, reject, or edit submitted scores
- 🎯 **Double Elimination Brackets** - Support for head-to-head tournament scoring
- 🔒 **Access Codes** - Judges access scoresheets via secure access codes (no login required)

## Supported Field Types

Score sheet templates support the following field types:

- **Text** - Free-form text input
- **Number** - Numeric input with min/max/step validation
- **Dropdown** - Select from predefined options
- **Buttons** - Multiple choice with visual button selection
- **Checkbox** - Boolean (true/false) values

## Prerequisites

- Node.js 16+ and npm
- Google Cloud Platform account with OAuth 2.0 credentials
- Google Drive and Sheets API enabled

## Setup Instructions

### 1. Clone and Install

```bash
cd colosseum
npm install
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - Google Drive API
   - Google Sheets API
4. Create OAuth 2.0 credentials:
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
5. Copy the Client ID and Client Secret

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` and add your Google OAuth credentials:

```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
SESSION_SECRET=your-random-session-secret
ALLOWED_EMAIL_DOMAINS=yourdomain.org  # Optional: restrict admin access to specific domains
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

In production, Express serves the built React app at `http://localhost:3000`

**⚠️ Important**: During development, always use `http://localhost:5173` (Vite) for the frontend, NOT port 3000.

## Usage Guide

### For Users

1. **Login** - Click "Login with Google" and authorize the application
2. **Admin Setup** - Go to Admin page to:
   - Link a Google Spreadsheet from your Drive
   - Create or select a score sheet template
3. **Score Items** - Return to home page, select a template, and start scoring

### For Administrators

#### Linking a Spreadsheet

1. Navigate to Admin → Spreadsheets tab
2. Click "Browse My Google Drive"
3. Select a spreadsheet from the list
4. Enter the sheet name (e.g., "Sheet1")
5. The spreadsheet is now linked and active

#### Creating a Template

1. Navigate to Admin → Templates tab
2. Click "Create New Template"
3. Enter template details:
   - **Name**: Template name
   - **Description**: Optional description
   - **Schema**: JSON definition of fields (see below)

#### Template Schema Example

```json
{
  "fields": [
    {
      "id": "participant",
      "label": "Participant Name",
      "type": "text",
      "required": true,
      "placeholder": "Enter name"
    },
    {
      "id": "score",
      "label": "Score",
      "type": "number",
      "required": true,
      "min": 0,
      "max": 100,
      "step": 1
    },
    {
      "id": "category",
      "label": "Category",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Category A", "value": "a" },
        { "label": "Category B", "value": "b" }
      ]
    },
    {
      "id": "rating",
      "label": "Overall Rating",
      "type": "buttons",
      "required": true,
      "options": [
        { "label": "Excellent", "value": "5" },
        { "label": "Good", "value": "4" },
        { "label": "Fair", "value": "3" },
        { "label": "Poor", "value": "2" }
      ]
    },
    {
      "id": "passed",
      "label": "Passed Assessment",
      "type": "checkbox",
      "checkboxLabel": "Yes, passed"
    }
  ]
}
```

## Project Structure

```
colosseum/
├── src/
│   ├── client/                  # React frontend
│   │   ├── components/          # Reusable React components
│   │   │   ├── admin/           # Admin-specific components
│   │   │   ├── Navbar.tsx
│   │   │   ├── AccessCodeModal.tsx
│   │   │   └── ScoresheetForm.tsx
│   │   ├── contexts/            # React contexts (Auth, Theme)
│   │   ├── pages/               # Page components
│   │   ├── styles/              # Global styles
│   │   ├── utils/               # Utility functions
│   │   ├── App.tsx              # Main React app with routing
│   │   ├── main.tsx             # React entry point
│   │   └── index.html           # HTML template
│   └── server/                  # Express backend
│       ├── config/
│       │   └── passport.ts      # Google OAuth configuration
│       ├── database/
│       │   ├── connection.ts    # Database connection
│       │   └── init.ts          # Database schema initialization
│       ├── middleware/
│       │   └── auth.ts          # Authentication middleware
│       ├── routes/
│       │   ├── auth.ts          # Authentication routes
│       │   ├── admin.ts         # Admin panel routes
│       │   ├── scoresheet.ts    # Template management routes
│       │   ├── scores.ts        # Score review/approval routes
│       │   ├── data.ts          # Dynamic data fetching routes
│       │   └── api.ts           # Score submission routes
│       ├── services/
│       │   ├── googleSheets.ts  # Google Sheets API integration
│       │   ├── bracketParser.ts # Double elimination bracket parsing
│       │   └── tokenRefresh.ts  # OAuth token refresh service
│       └── server.ts            # Express server setup
├── docs/                        # Documentation
│   ├── BOTBALL_SETUP.md
│   ├── DYNAMIC_FIELDS_GUIDE.md
│   ├── MULTI_SHEET_GUIDE.md
│   └── TEMPLATE_SCHEMA_GUIDE.md
├── templates/                   # Example score sheet templates
│   ├── botball-de-template.json
│   └── botball-seeding-template.json
├── static/                      # Static assets (images, etc.)
├── database/                    # SQLite databases (auto-created)
├── dist/                        # Build output
├── vite.config.ts               # Vite configuration
├── tsconfig.json                # TypeScript config
├── package.json
└── .env                         # Environment variables
```

## Database Schema

The application uses SQLite with the following tables:

- **users** - User accounts and OAuth tokens
- **spreadsheet_configs** - Linked Google Spreadsheets
- **scoresheet_templates** - Score sheet template definitions
- **score_submissions** - Submitted scores
- **active_sessions** - Active user sessions

## API Endpoints

### Authentication

- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/user` - Get current user
- `GET /auth/logout` - Logout

### Admin

- `GET /admin/spreadsheets` - List linked spreadsheets
- `GET /admin/drive/spreadsheets` - Browse Google Drive spreadsheets
- `POST /admin/spreadsheets/link` - Link a spreadsheet
- `PUT /admin/spreadsheets/:id/activate` - Activate a spreadsheet
- `DELETE /admin/spreadsheets/:id` - Delete spreadsheet config

### Templates

- `GET /scoresheet/templates` - List all templates
- `GET /scoresheet/templates/:id` - Get template details
- `POST /scoresheet/templates` - Create new template
- `PUT /scoresheet/templates/:id` - Update template

### Scores

- `POST /api/scores/submit` - Submit a score
- `GET /api/scores/history` - Get score history
- `GET /api/participants` - Get participants from spreadsheet
- `GET /api/matches` - Get matches from spreadsheet

## Development

### Tech Stack

- **Frontend**: React 19, TypeScript, React Router, Vite
- **Backend**: Node.js, Express, TypeScript
- **Database**: SQLite3
- **Authentication**: Passport.js with Google OAuth 2.0
- **Build Tools**: Vite (frontend), TypeScript Compiler (backend)
- **APIs**: Google Drive API, Google Sheets API

### Building

```bash
npm run build
```

Builds both React frontend and Express backend:

- React app → `dist/client/`
- Express server → `dist/server/`

### Development Servers

```bash
npm run dev
```

Runs both servers concurrently:

- **Vite** (React with HMR): http://localhost:5173 ← **Use this for development**
- **Express** (API): http://localhost:3000

Changes to React components update instantly (Hot Module Replacement).
Changes to Express server restart automatically (nodemon).

**Individual servers:**

```bash
npm run dev:client  # Vite only
npm run dev:server  # Express only
```

## Troubleshooting

### "Authentication required" errors

- Ensure you're logged in with Google
- Check that OAuth credentials are correctly configured
- Verify redirect URI matches in Google Cloud Console

### "No active spreadsheet configuration found"

- Link a spreadsheet in the Admin panel
- Ensure the spreadsheet is marked as "Active"

### Scores not syncing to Google Sheets

- Verify spreadsheet permissions (app needs write access)
- Check that the sheet name matches exactly
- Review browser console for API errors

## Contributing

Contributions welcome! Please ensure code follows the existing style and includes appropriate error handling.

## License

ISC

## Support

For issues or questions, please check the error logs or contact the development team.
