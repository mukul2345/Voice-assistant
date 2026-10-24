# Implementation Plan: Interview Copilot MVP

## Overview

This plan converts the Interview Copilot MVP design into incremental implementation tasks. The app already has an Electron shell, Express server, React frontend, and audio capture working. The tasks focus on migrating from JSON file storage to SQLite, adding authentication, trial/subscription enforcement, context management, and hardening for production distribution. All code is TypeScript.

## Tasks

- [x] 1. Database foundation — SQLite + Drizzle schema
  - [x] 1.1 Replace the PostgreSQL Drizzle schema with SQLite schema
    - Replace `shared/schema.ts` contents with the SQLite-based Drizzle schema from the design (users, refreshTokens, trialUsage, subscriptions, sessions, messages tables)
    - Switch imports from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`
    - Add `better-sqlite3` dependency and remove `pg` / `connect-pg-simple`
    - Update `drizzle.config.ts` to use the SQLite driver pointing to `data/copilot.db`
    - Export Zod insert schemas for each table using `drizzle-zod`
    - _Requirements: 2.3, 4.3, 9.6_

  - [x] 1.2 Create the database connection module and migration runner
    - Create `server/db/index.ts` that initializes `better-sqlite3` with the SQLite file and exports a Drizzle instance
    - Create `server/db/migrate.ts` that runs Drizzle migrations on startup (called from `server/index.ts`)
    - Generate initial migration with `drizzle-kit generate`
    - _Requirements: 2.3, 4.3_

  - [x] 1.3 Replace MemStorage with a Drizzle-based storage layer
    - Rewrite `server/storage.ts` to implement `IStorage` using Drizzle queries against the new SQLite schema
    - Add CRUD methods for users, sessions, messages, trialUsage, subscriptions, refreshTokens
    - Remove the JSON file-based `MemStorage` class and `data/messages.json` dependency
    - _Requirements: 2.3, 4.3, 5.3_

  - [ ]* 1.4 Write unit tests for the storage layer
    - Test insert/select round-trips for each table
    - Test unique constraints (duplicate email, duplicate stripe subscription ID)
    - Use an in-memory SQLite instance for isolation
    - _Requirements: 2.3, 4.3_

- [x] 2. Authentication — bcrypt + JWT + middleware
  - [x] 2.1 Implement the Auth Service (`server/auth/service.ts`)
    - Implement `register(email, password)` — validate email format, hash with bcrypt (cost 10+), create user + trial_usage row, return TokenPair
    - Implement `login(email, password)` — verify credentials, issue JWT access token (15-min expiry) + refresh token (7-day expiry, stored in DB)
    - Implement `refresh(refreshToken)` — validate token exists, not revoked, not expired; issue new access token
    - Implement `logout(userId, refreshToken)` — revoke the token in DB
    - Use a generic "invalid email or password" error for both wrong-email and wrong-password cases
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [x] 2.2 Implement Auth Middleware (`server/auth/middleware.ts`)
    - Create `authenticate` middleware — extract Bearer token from Authorization header, verify JWT, attach `req.user`
    - Create `optionalAuth` middleware — same as authenticate but continues on failure (for public routes)
    - Return 401 with appropriate error codes (TOKEN_MISSING, TOKEN_EXPIRED) on failure
    - _Requirements: 1.6_

  - [x] 2.3 Register auth routes in Express
    - POST `/api/auth/register` — calls AuthService.register
    - POST `/api/auth/login` — calls AuthService.login
    - POST `/api/auth/refresh` — calls AuthService.refresh
    - POST `/api/auth/logout` — protected, calls AuthService.logout
    - Apply `authenticate` middleware to all existing `/api/` routes (process-audio, messages, etc.)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

  - [ ]* 2.4 Write property tests for auth (Properties 1–7)
    - **Property 1: Password Registration Round-Trip** — register then bcrypt.compare returns true, cost >= 10
    - **Property 2: Token Expiry Invariants** — JWT exp ~15min, refresh exp ~7 days
    - **Property 3: Generic Auth Error on Invalid Credentials** — same error message regardless of which field wrong
    - **Property 4: Refresh Token Issues New Access Token** — valid refresh → new JWT
    - **Property 5: Logout Invalidates Refresh Token** — post-logout refresh fails
    - **Property 6: Protected Routes Reject Invalid Tokens** — missing/expired/malformed → 401
    - **Property 7: Duplicate Email Registration Rejected** — second register same email fails
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**

- [ ] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Trial system — server-side enforcement
  - [x] 4.1 Implement the Trial Manager (`server/trial/manager.ts`)
    - Implement `checkAccess(userId)` — query trial_usage + subscription status, return AccessResult
    - Implement `recordUsage(userId, durationSeconds)` — atomically increment used_seconds
    - Implement `getRemainingTime(userId)` — return total_allowed - used_seconds
    - On new user registration, initialize trial_usage with 3600 total_allowed_seconds and 0 used_seconds
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7_

  - [x] 4.2 Integrate Trial Manager into the audio processing route
    - Before processing audio, call `trialManager.checkAccess(userId)`
    - If denied, return 403 with TRIAL_EXPIRED error code and subscribe link
    - After successful processing, call `trialManager.recordUsage(userId, audioDuration)`
    - _Requirements: 2.2, 2.4, 2.5_

  - [ ]* 4.3 Write property tests for trial system (Properties 8–10)
    - **Property 8: New User Trial Initialization** — new user gets 3600 total, 0 used
    - **Property 9: Trial Usage Additive Accumulation** — sum of durations == used_seconds
    - **Property 10: Exhausted Trial Blocks Audio Processing** — used >= total AND no sub → 403
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6**

- [x] 5. Subscription — Stripe integration
  - [x] 5.1 Implement the Subscription Manager (`server/subscription/manager.ts`)
    - Implement `createCheckoutSession(userId)` — create Stripe Checkout session with success/cancel URLs, return hosted URL
    - Implement `handleWebhook(event)` — process checkout.session.completed (activate), customer.subscription.deleted (deactivate), invoice.payment_failed (deactivate + set grace period)
    - Implement `getStatus(userId)` — query subscription record, compute active/inactive/grace
    - Set 3-day grace period on deactivation (grace_period_end = now + 3 days)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

  - [x] 5.2 Register Stripe routes and webhook endpoint
    - POST `/api/subscription/checkout` — protected, calls createCheckoutSession
    - POST `/api/webhooks/stripe` — raw body parsing, verify signature with stripe webhook secret, call handleWebhook
    - GET `/api/subscription/status` — protected, calls getStatus
    - _Requirements: 3.1, 3.2, 3.7_

  - [x] 5.3 Integrate subscription status into trial access checks
    - Update `trialManager.checkAccess` to query subscription status
    - If subscription active → allow regardless of trial usage
    - If subscription inactive but within grace period → allow
    - If subscription inactive and past grace → deny (unless trial remains)
    - _Requirements: 3.4, 3.5_

  - [ ]* 5.4 Write property tests for subscription (Properties 11–15)
    - **Property 11: Active Subscription Bypasses Trial** — sub active → audio allowed even if trial exhausted
    - **Property 12: Webhook Activates Subscription** — checkout.session.completed → status active
    - **Property 13: Webhook Deactivates Subscription** — subscription.deleted / payment_failed → status inactive
    - **Property 14: Grace Period Access Window** — access allowed before grace end, denied after
    - **Property 15: Webhook Signature Verification** — invalid signature → request rejected
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

- [ ] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Context management — sessions and file parsing
  - [x] 7.1 Implement the Context Manager (`server/context/manager.ts`)
    - Implement `createSession(userId, data)` — insert session row, return session
    - Implement `updateSession(sessionId, data)` — partial update, return updated session
    - Implement `getSession(sessionId)` — fetch session with ownership check
    - Implement `listSessions(userId)` — fetch all sessions for user
    - Implement `parseResume(file, mimeType)` — extract text from PDF (pdf-parse) and DOCX (mammoth), reject files > 5MB or unsupported MIME
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

  - [x] 7.2 Register context/session API routes
    - POST `/api/sessions` — create session
    - GET `/api/sessions` — list sessions
    - GET `/api/sessions/:id` — get session
    - PUT `/api/sessions/:id` — update session
    - POST `/api/sessions/:id/resume` — upload resume file (multer, 5MB limit)
    - All routes protected with `authenticate` middleware
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

  - [x] 7.3 Integrate session context into the AI response generation
    - Modify the audio processing route to accept a `sessionId` parameter
    - Load the active session's context (company, JD, resume, skills, notes) from DB
    - Include all context fields in the AI prompt construction
    - Store messages with the session_id and user_id foreign keys
    - _Requirements: 4.4, 6.3_

  - [ ]* 7.4 Write property tests for context management (Properties 16–18)
    - **Property 16: Session Context Round-Trip** — create session then retrieve returns identical fields
    - **Property 17: AI Prompt Includes All Context Fields** — all 5 fields present as substrings in prompt
    - **Property 18: File Upload Validation** — > 5MB or wrong MIME → rejected with correct error
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5**

- [x] 8. AI pipeline enhancements — conversation memory, interview types, caching
  - [x] 8.1 Implement the Conversation Memory builder (`server/ai/conversation-memory.ts`)
    - Build rolling summary of messages older than the last 5 Q&A pairs
    - Include last 5 exchanges in full text
    - Return structured `ConversationMemory` object for prompt construction
    - _Requirements: 6.3_

  - [x] 8.2 Implement interview type detection (`server/ai/interview-types.ts`)
    - Refactor existing `server/services/interview-types.ts` into the new module location
    - Ensure detection covers: behavioral, technical, coding, system-design, general
    - Format response as exactly 3 bullet points tailored to detected type
    - _Requirements: 6.5, 6.6_

  - [x] 8.3 Implement duplicate question detection and response caching
    - Extract duplicate detection logic from routes.ts into `server/ai/duplicate-detection.ts`
    - Compute word overlap (intersection of significant words / max set size)
    - If overlap >= 0.80, return cached response from prior message in same session
    - _Requirements: 6.4_

  - [ ]* 8.4 Write property tests for AI modules (Properties 21–23)
    - **Property 21: Conversation Memory Construction** — N > 5 messages → summary of 1..(N-5) + full of (N-4)..N
    - **Property 22: Duplicate Question Cache Hit** — overlap >= 0.80 → cached, < 0.80 → new response
    - **Property 23: Interview Type Detection** — coding keywords → "coding", system-design keywords → "system-design", etc.
    - **Validates: Requirements 6.3, 6.4, 6.5**

- [x] 9. Audio pipeline hardening — VAD, filler filter, error boundaries
  - [x] 9.1 Harden the filler filter (`server/audio/filler-filter.ts`)
    - Extract filler filter logic from routes.ts into a standalone pure function module
    - Filter criteria: < 12 chars OR matches known filler phrases (case-insensitive)
    - Export a clean `filterFiller(text: string): boolean` function
    - _Requirements: 5.7_

  - [x] 9.2 Add audio input validation and temporary file cleanup
    - Validate uploaded audio file MIME type (webm, ogg, mp4, wav accepted)
    - Ensure temp files are always deleted in finally blocks (success + error paths)
    - Add audio duration extraction to track trial usage per segment
    - _Requirements: 9.6, 10.2, 10.6_

  - [x] 9.3 Add Groq API retry with exponential backoff
    - Create `server/utils/retry.ts` implementing RetryConfig from design (3 attempts, base 1s, max 10s, 2x multiplier + jitter)
    - Wrap all Groq API calls (transcription + chat) with retry logic
    - On 429 rate limit, respect retry-after header if present
    - _Requirements: 12.1, 12.4_

  - [ ]* 9.4 Write property tests for audio pipeline (Properties 19, 20, 24, 25, 27)
    - **Property 19: VAD Question Boundary Detection** — 1.8s silence after speech → boundary; 90s max → force segment
    - **Property 20: Filler Filter Discards Non-Substantive Text** — < 12 chars or filler → true; else → false
    - **Property 24: Temporary File Cleanup** — after handler completes, temp file does not exist
    - **Property 25: Rate Limiting Enforcement** — 100 requests in 60s window → 429 on next
    - **Property 27: Exponential Backoff Retry** — delays approximately double each attempt
    - **Validates: Requirements 5.2, 5.6, 5.7, 9.6, 10.1, 10.6, 12.1, 12.4**

- [ ] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Desktop app production features — single-instance, localhost binding, auto-update
  - [x] 11.1 Add single-instance lock and localhost binding to Electron main process
    - Use `app.requestSingleInstanceLock()` — quit if another instance is running
    - Change Express server bind from `0.0.0.0` to `127.0.0.1` in `server/index.ts`
    - Show the existing window when second instance is attempted
    - _Requirements: 9.1, 9.2_

  - [x] 11.2 Add React Error Boundary to the renderer
    - Create `client/src/components/error-boundary.tsx` wrapping the App component
    - Display a recovery UI with "Reload" button on unhandled renderer errors
    - Log errors to console for debugging
    - _Requirements: 9.4_

  - [x] 11.3 Integrate electron-updater for auto-updates via GitHub Releases
    - Install `electron-updater` and configure `electron-builder.yml` for GitHub provider
    - Add update check on app ready (non-blocking)
    - Show notification to user when update is available, offer download + install
    - Silently skip if GitHub unreachable
    - _Requirements: 11.2, 11.3, 11.4_

  - [x] 11.4 Configure electron-builder for macOS DMG and Windows NSIS/portable packaging
    - Update `package.json` build config with proper code-signing placeholders
    - Add macOS DMG and zip targets, Windows NSIS and portable targets
    - Add documentation for macOS Gatekeeper bypass (self-signed)
    - _Requirements: 11.1, 11.5_

- [x] 12. Security hardening and cleanup
  - [x] 12.1 Add rate limiting middleware
    - Install `express-rate-limit` and configure per-user rate limiting (100 req/min)
    - Apply to all `/api/` routes
    - Return 429 with RATE_LIMITED error code when exceeded
    - _Requirements: 10.1_

  - [x] 12.2 Add input validation and CORS restriction
    - Add request body size limits: 10,000 char max for text fields
    - Add file upload size limit enforcement (5 MB) via multer config
    - Configure CORS to allow only `http://localhost:*` origins
    - Validate Groq API key on startup, log clear error if missing
    - _Requirements: 10.2, 10.3, 10.4_

  - [ ] 12.3 Add Groq rate limit awareness and user notifications
    - Track daily transcription usage (28,800 seconds/day limit)
    - Expose GET `/api/usage/transcription` returning remaining daily capacity
    - Return clear error when daily limit exhausted with reset time
    - _Requirements: 12.2, 12.3_

  - [x] 12.4 Remove dead code and finalize route wiring
    - Remove `server/services/interview-types.ts` (replaced by `server/ai/interview-types.ts`)
    - Remove `passport`, `passport-local`, `express-session`, `connect-pg-simple`, `memorystore`, `pg` from dependencies
    - Remove any remaining references to the old MemStorage/JSON persistence
    - Ensure all routes are wired through the new auth + trial + subscription middleware chain
    - _Requirements: 10.5_

  - [ ]* 12.5 Write property tests for security (Properties 25, 26)
    - **Property 25: Rate Limiting Enforcement** — 100 requests in 60s → next request gets 429
    - **Property 26: Input Size Validation** — text > 10,000 chars → rejected; file > 5MB → rejected
    - **Validates: Requirements 10.1, 10.2**

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (27 properties)
- Unit tests validate specific examples and edge cases
- All implementation uses TypeScript with the existing project tooling (Jest, fast-check, Drizzle, Express, React)
- The existing audio capture, VAD, and stealth overlay functionality remain intact — tasks add auth/billing/hardening layers around them

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3", "2.4"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2", "4.3"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3"] },
    { "id": 10, "tasks": ["5.4", "7.1"] },
    { "id": 11, "tasks": ["7.2", "8.1", "8.2", "8.3"] },
    { "id": 12, "tasks": ["7.3", "7.4", "8.4"] },
    { "id": 13, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 14, "tasks": ["9.4", "11.1", "11.2"] },
    { "id": 15, "tasks": ["11.3", "11.4", "12.1"] },
    { "id": 16, "tasks": ["12.2", "12.3"] },
    { "id": 17, "tasks": ["12.4", "12.5"] }
  ]
}
```
