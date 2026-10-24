# Interview Copilot

Interview Copilot is an Electron desktop application with a React renderer, a local Express API, and SQLite persistence. It captures user-selected meeting audio or screenshots, sends them to a configured AI provider, and displays answer suggestions.

## Security and platform limitations

- Interview sessions and messages are scoped to the authenticated local user.
- API request logs contain metadata only; tokens, transcripts, prompts, resumes, and generated answers are redacted.
- The Electron overlay requests OS content protection on supported macOS and Windows versions. This is **best effort**, not a guarantee: behavior varies by OS, capture API, conferencing application, and sharing mode.
- Never assume the overlay is invisible. Verify behavior with the exact screen-sharing setup before use.
- Use this application only where assistance is permitted by the interview or assessment rules.

## Requirements

- Node.js 20 or later
- macOS or Windows for the Electron application
- A Groq or OpenAI API key

## Development setup

```bash
npm install
cp .env.example .env
openssl rand -hex 48
```

Place the generated value in `JWT_SECRET`, configure `GROQ_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY`, then start:

```bash
npm run electron:dev
```

Development runs the backend externally on `127.0.0.1:5000`. Electron waits for `/health` before creating windows.

## Configuration

| Variable | Requirement |
|---|---|
| `JWT_SECRET` | Required in production; minimum 32 characters |
| `GROQ_API_KEY` | Required in production unless OpenAI is configured |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Required in production unless Groq is configured |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Optional OpenAI-compatible endpoint |
| `PORT` | Local API port; `0` selects an available port |
| `COPILOT_DATA_DIR` | Optional SQLite/upload directory override |
| `STRIPE_SECRET_KEY` | Optional, but all Stripe variables must be supplied together |
| `STRIPE_WEBHOOK_SECRET` | Optional Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Optional Stripe price identifier |

Production startup fails fast for an unsafe JWT secret, an invalid port, missing AI credentials, or partial Stripe configuration.

## Desktop startup

In development, `npm run electron:dev` launches the server and Electron separately.

In packaged builds, Electron:

1. Starts the bundled `dist/index.cjs` backend on an available loopback port.
2. Stores SQLite data under Electron's per-user application-data directory.
3. Waits for a successful `/health` response with a bounded timeout.
4. Creates renderer windows only after readiness.
5. terminates the backend child process when Electron quits.

A startup dialog is shown if the backend cannot become ready.

## Usage

1. Register or sign in.
2. Create an interview session and provide only the context you intend to send to the configured AI provider.
3. Start capture and explicitly select a source that includes the required audio.
4. Toggle the answer overlay with `Cmd+Shift+A` on macOS or `Ctrl+Shift+A` on Windows.
5. Stop capture when finished.

Additional shortcuts:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Shift+A` | Toggle overlay |
| `Cmd/Ctrl+Shift+R` | Reload overlay |
| `Cmd/Ctrl+Shift+M` | Show main window |

## Validation

```bash
npm run check
npm test -- --runInBand
npm run build
```

The test suite includes production configuration validation, structured-log redaction, cross-user storage isolation, and backend readiness/shutdown coverage. Historical bug-exploration scenarios remain as a skipped documentation suite until replaced with production-code tests.

## Building

```bash
npm run electron:build:mac
npm run electron:build:win
```

Each Electron build script first produces the renderer and `dist/index.cjs` backend bundle. Installers are written to `dist-electron/`.

For packaged execution, provide the AI provider credential through the launch environment or an approved deployment-specific secret mechanism. Electron creates and persists a private local JWT signing secret automatically; it does not embed a public fallback secret.

## Architecture

```text
Electron main process
├── packaged backend child process
├── bounded /health readiness check
├── restricted BrowserWindow navigation and permissions
└── main window + best-effort protected overlay

Express API
├── auth and tenant-scoped persistence
├── interview/session routes
├── AI provider calls
├── metadata-only structured logging
└── SQLite (WAL + foreign keys)

React renderer
├── authentication
├── context/session setup
├── audio and screen capture
└── message/answer display
```

Legacy `server/replit_integrations` code is quarantined and excluded from active TypeScript compilation. It is retained only for explicit future migration or deletion approval.

## Current scope

This stabilization phase does not add streaming speech-to-text, streaming model responses, WebSockets, a transcript event model, new stealth mechanisms, or a UI redesign. The current pipeline remains request/response based.

## License

MIT
