# Interview Copilot Repository Audit

**Audit date:** 2026-08-30  
**Status:** Phase 1 complete; no production behavior changed  
**Scope:** package and lock files, documentation, configuration, frontend, Electron shell, backend, API routes, auth, storage, audio, transcription, AI, realtime transport, tests, build, packaging, deployment, permissions, security, privacy, logging, and error handling.

## Executive Summary

The repository is a **hybrid Electron desktop application** whose renderer is a React/Vite web app served by a local Express/TypeScript backend. SQLite/Drizzle stores users, sessions, subscriptions, and combined transcript/answer messages. Browser `getDisplayMedia` captures a user-selected tab/window/screen, `MediaRecorder` buffers audio, and a monolithic HTTP endpoint sends each completed blob to Groq or OpenAI for transcription and a non-streaming answer.

This is a partially working prototype, not a production-ready realtime copilot. The strongest reusable pieces are the React UI shell, local SQLite persistence, basic auth primitives, resume parsing, Electron context isolation, and the intent to clean temporary files. The core interview pipeline requires staged refactoring rather than a blind rewrite.

The most urgent blockers are:

1. **Critical cross-user data leakage:** audio and screen routes read/write messages without consistent `userId`/`sessionId` ownership.
2. **Critical sensitive logging:** global response logging serializes tokens, transcriptions, and AI responses.
3. **Packaged app startup is broken:** Electron does not launch the bundled backend and assumes port 5000 while the server may silently choose another port.
4. **No realtime or streaming pipeline:** no active WebSocket/SSE/WebRTC implementation; each answer waits for full upload, STT, and LLM completion.
5. **No explicit session state machine or transcript event model:** partial/final segments, sequence numbers, idempotency, cancellation, and stale-answer protection are absent.
6. **Audio correctness/resource defects:** instantaneous VAD is applied to one-second blobs, silence chunks are dropped, concurrent questions are discarded, and a VAD interval cleanup callback is lost.
7. **Stealth claims are unsafe:** only the Electron overlay requests content protection, capture behavior is platform/capture-stack dependent, and the README falsely promises universal invisibility.
8. **Configuration and auth fail open:** JWT uses a known fallback secret; provider configuration is scattered and missing validation.
9. **Validation is red:** TypeScript reports 19 errors; Jest has one passing simulation suite and one invalid suite; there are no product integration/E2E tests.
10. **Repository drift:** active logic is duplicated in `server/routes.ts` while designed helper modules and incompatible Replit integrations remain unused or broken.

## Current Architecture

```text
Electron main process (`electron/main.cjs`)
├── Main BrowserWindow -> http://localhost:5000
├── Overlay BrowserWindow -> /stealth
├── global shortcuts / updater / best-effort content protection
└── preload bridge (`electron/preload.cjs`)

React renderer (`client/src`)
├── AuthProvider + localStorage bearer/refresh tokens
├── Home page + context form + history
├── useAudioCapture -> getDisplayMedia -> MediaRecorder -> VAD buffer
├── useCopilot -> multipart HTTP requests / React Query invalidation
├── Stealth page -> polls `/api/messages` every 2 seconds
└── optional Document Picture-in-Picture view

Express backend (`server`)
├── auth / subscription / trial / context routes
├── `/api/process-audio` -> temp file -> STT -> prompt -> LLM -> message
├── `/api/analyze-screen` -> temp image -> vision -> LLM -> message
├── SQLite/Drizzle storage
└── static Vite bundle in production

External systems
├── Groq OpenAI-compatible API (preferred STT/chat/vision)
├── OpenAI API (fallback)
├── Stripe
└── GitHub Releases via electron-updater
```
### Active Interview Data Flow

1. Authenticated renderer loads `Home.tsx`; tokens are read from renderer `localStorage`.
2. User enters free-form context or enhanced resume/project context.
3. `useAudioCapture` calls `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`; this is display-source capture, not microphone capture despite microphone-oriented UI/errors.
4. A one-second `MediaRecorder` timeslice is sampled against the analyser's current volume. Blobs considered speech are buffered; blobs considered silence are discarded.
5. After 1.8 seconds of observed silence, the buffered WebM blob is uploaded to `/api/process-audio`.
6. The server writes the blob to `uploads/`, calls Groq Whisper or OpenAI transcription, builds prompt/context/history, calls chat completion, writes a combined `messages` row, deletes the file, and returns a complete JSON response.
7. React Query invalidates `/api/messages`; the main UI refetches. The stealth route independently polls every two seconds.
8. Optional screen analysis captures a video frame, writes JPEG to disk, sends base64 image to vision, sends extracted text to chat, and persists another message.

This flow has no partial transcript, event sequencing, speaker attribution, question entity, answer entity, first-token stream, cancellation, or request association beyond the HTTP request itself.

### Platform and Stealth Determination

The primary product is Electron 41 on macOS/Windows/Linux, with browser-compatible renderer behavior. Two separate Python/Tkinter prototypes also exist. The Electron overlay is frameless, always-on-top, skipped from taskbar, and calls `setContentProtection(true)` on macOS and Windows. The main window is not content-protected.

`setContentProtection` is a best-effort framework/OS capability, not proof of invisibility across Zoom, Meet, Teams, Webex, screenshots, browser-tab capture, application-window capture, entire-screen capture, external cameras, or future OS changes. Browser/PiP windows cannot guarantee capture exclusion. Linux has no implemented exclusion path. The app also cannot universally detect capture initiated by another application. `getDisplayMedia` only describes capture initiated by this app and its track lifecycle.

The current README statements “invisible to screen capture” and “works with any screen sharing app” are unsupported and must be replaced with a tested platform/capture matrix and local warning/fail-safe behavior.

## What Exists by Subsystem

| Subsystem | Current implementation | Assessment |
|---|---|---|
| Frontend | React 18, Vite, Wouter, TanStack Query, Tailwind/shadcn, error boundary | Usable shell; business/session logic concentrated in hooks/pages |
| State | React local state, refs, React Query, Auth context | No authoritative interview session state machine |
| Desktop | Electron main/preload, two windows, shortcuts, updater, single-instance lock | Useful shell; backend lifecycle, permissions, IPC, sandbox, and stealth honesty need hardening |
| Audio | `getDisplayMedia`, Web Audio analyser, `MediaRecorder`, ad-hoc VAD | Captures shared-source audio only; correctness and cleanup defects |
| Transcription | Direct OpenAI-compatible SDK call inside `/api/process-audio` | Batch-only and vendor-coupled; no service/provider abstraction |
| AI | Groq-or-OpenAI selection and direct completion calls in `server/routes.ts` | Non-streaming, no provider interface, weak error taxonomy/cancellation |
| Prompting | `server/services/interview-types.ts` plus route-local assembly and vision prompt | Partially centralized but unversioned and transcript boundaries are weak |
| Context | Session table, resume parser, free-form context, last-five plus lossy string summary | Useful foundation; duplicate implementations, no bounded factual retrieval/compaction policy |
| Storage | Local SQLite + Drizzle tables for auth, sessions, subscriptions, messages | Appropriate for local-first MVP; ownership and data model are insufficient |
| Auth | bcrypt, JWT access token, opaque DB refresh token, middleware | Basic primitives exist; fallback secret, localStorage tokens, optional auth, logout ownership issue |
| Realtime | None active; `ws` dependency unused; stale Replit SSE modules do not compile/register | Missing |
| Observability | `console.*`, HTTP duration line, response-body serialization | Unsafe and not structured; no correlation IDs or metrics |
| Testing | Jest + fast-check simulations under `client/src/__tests__` | Does not test production modules or browser/Electron behavior |
| Deployment | Vite/esbuild bundle, electron-builder DMG/ZIP/NSIS/portable/AppImage/deb, GitHub updater | Buildable artifacts; unsigned macOS config, no verified CI/sign/notarize/update chain |
| Alternate capture | `system_session.py` + Tkinter + sounddevice + virtual audio device | Separate unsupported stack with fixed chunks and no auth/session lifecycle |
| CI/Docker | No project CI workflow or Dockerfile found | Missing |
## Module Classification

`KEEP` means preserve behavior/API while hardening. `REFACTOR` means retain the concept but change boundaries. `REWRITE` is reserved for fundamentally unsafe/incompatible implementations. `REMOVE` means delete only after confirming no caller. `MISSING` identifies required new boundaries.

| Module / area | Classification | Evidence and intended treatment |
|---|---|---|
| `client/src/App.tsx` | KEEP | Clear top-level providers/routes/error boundary; add session provider later |
| UI primitives and focused display components | KEEP | Existing shadcn/Tailwind base is serviceable; improve accessibility incrementally |
| `client/src/pages/Home.tsx` | REFACTOR | Large orchestration component; split session controls/status/transcript/answer without redesigning all UI |
| `client/src/pages/Stealth.tsx` | REFACTOR | Polling omits auth header and derives fake processing state; consume typed answer stream/state and show capability warning |
| `client/src/hooks/use-auth.tsx` | REFACTOR | Preserve auth UX; move refresh token out of renderer localStorage where practical, centralize authenticated fetch, remove silent catches |
| `client/src/hooks/use-copilot.ts` | REFACTOR | Preserve typed Zod response parsing; move retry/cancellation/request IDs to transport client |
| `client/src/hooks/use-audio-capture.ts` | REWRITE | Ad-hoc state/VAD/queue/cleanup cannot safely support required lifecycle and device errors |
| `client/src/hooks/use-silence-detection.ts` | REMOVE | Duplicate, apparently unused audio detection loop; remove after caller check |
| `client/src/hooks/useConversationMemory.ts` | REMOVE | Duplicate unused client memory with unauthenticated summarize call and unbounded history |
| `client/src/hooks/use-pip.ts` | REFACTOR | Keep optional Chromium feature; close/listener lifecycle and stealth limitations need explicit handling |
| `shared/routes.ts` | REFACTOR | Keep shared boundary validation; adopt consistent `ApiResponse`, event unions, IDs, and all status schemas |
| `shared/schema.ts` | REFACTOR | Keep SQLite entities; add explicit session status plus transcript/question/answer separation and ownership constraints |
| `server/index.ts` | REFACTOR | Separate app creation/bootstrap/config/logging/cleanup; stop leaking response bodies and swallowing cleanup errors |
| `server/routes.ts` | REWRITE | God route combines upload, STT, context, dedupe, prompts, AI, persistence, billing, errors, and screen analysis |
| `server/storage.ts` | REWRITE | All tenant-owned reads/writes must require ownership scope; no optional unscoped production methods |
| `server/db/index.ts` | KEEP | SQLite WAL/foreign keys are reasonable for local-first app; use OS application-data path in packaged app |
| `server/db/migrate.ts` | REFACTOR | Replace manual create-only schema drift with versioned migrations and indexes/cascade policy |
| `server/context/manager.ts` | REFACTOR | Preserve ownership checks/resume parsing; validate inputs, remove `any`, structure/cache candidate profile |
| `server/auth/*` | REFACTOR | Preserve bcrypt/JWT/opaque refresh-token approach; fail-fast secret, stronger password/rate limits, token ownership/rotation |
| `server/ai/conversation-memory.ts` | REFACTOR | Useful bounded-context concept; current “summary” is truncation, not compaction, and active route duplicates it |
| `server/ai/duplicate-detection.ts` | REFACTOR | Reuse as question idempotency aid, scoped per session; lexical overlap alone must not return stale answers blindly |
| `server/audio/filler-filter.ts` | REFACTOR | Preserve filtering concept; active route duplicates it and length-only rules can discard valid questions |
| `server/services/interview-types.ts` | REFACTOR | Preserve classification/prompt intent; use explicit category model and versioned `PromptBuilder` |
| `server/services/vision.ts` | REFACTOR | Preserve optional screen assistance; validate image, avoid sync file read/base64 overhead, protect/authenticate route |
| `server/utils/retry.ts` | REFACTOR | Keep bounded backoff concept; add abort support, typed retry policy, no transcript-bearing logs |
| `server/replit_integrations/**` | REMOVE | Unregistered legacy scaffold, duplicate routes/providers, incompatible schema, source of all current TS errors |
| `electron/main.cjs` | REFACTOR | Preserve windows/shortcuts/single-instance lock; own backend process/port handshake, restrictive permissions, sandbox, capability state |
| `electron/preload.cjs` and duplicate `preload.js` | REFACTOR/REMOVE | Define minimal typed IPC actually implemented; remove duplicate/unused channels and production console output |
| `system_session.py` | REMOVE or isolate | Parallel fixed-chunk unauthenticated product path; retain only as explicitly unsupported experimental tool if required |
| `copilot_local.py` | REMOVE | Mock prototype with no production implementation |
| shell setup/launcher scripts | REFACTOR | Avoid force-killing arbitrary port process, interactive setup side effects, unpinned Python installs, and secret-pattern probing |
| README | REWRITE | Architecture/setup details are stale and stealth guarantees are false |
| Existing tests | REWRITE | Tests simulate copies of expected behavior and stale code comments instead of importing product modules |
| Lock file | KEEP | `package-lock.json` exists; manifests still use broad ranges and should be reviewed/pinned deliberately |
| Config validation | MISSING | Typed centralized startup validation, feature flags, provider/model/timeouts/context limits |
| Session state machine | MISSING | Explicit states/events/guards and one source of truth |
| Transcription abstraction | MISSING | Provider-neutral lifecycle with partial/final structured events and sequence handling |
| AI provider abstraction | MISSING | Streaming interface, classification, summarization, error mapping, cancellation |
| Realtime transport | MISSING | Authenticated SSE/WebSocket protocol, ordering, reconnect, idempotency, max message sizes |
| Structured observability | MISSING | Redacted logger, correlation IDs, metrics/latency spans, health/readiness |
| CI/CD quality gates | MISSING | Typecheck, lint, unit/integration/E2E/build, signed release workflow |
## Known Bugs and Risks

| ID | Root cause | Affected component | Severity | Proposed solution | Regression risk |
|---|---|---|---|---|---|
| A-01 | `storage.getMessages()` and `createMessage()` are called without ownership in audio/screen paths | Privacy, prompts, cached answers, message feed | **Critical** | Require `{userId, sessionId}` scope in storage APIs and DB writes; authenticate cost-bearing routes; backfill/quarantine null-owned rows | High: changes guest behavior and existing rows |
| A-02 | HTTP logger serializes every JSON response | Tokens, email, transcripts, AI answers | **Critical** | Replace with structured metadata-only logging and field/path redaction | Low |
| A-03 | Electron never starts `dist/index.cjs`; server may auto-increment port while Electron is fixed to 5000 | Packaged desktop startup | **Critical** | Electron owns child backend lifecycle, selects/reserves one port, waits on authenticated health endpoint, terminates child on quit | Medium/high: packaging/startup |
| A-04 | JWT falls back to a public hardcoded secret | Authentication | **Critical** | Validate a strong secret at startup; local packaged mode should generate/store OS-protected secret | Medium: dev setup |
| A-05 | `/api/summarize` and `/api/analyze-screen` lack required auth/trial controls | Cost abuse and private data | **High** | Require ownership-authenticated session and endpoint-specific rate limits | Medium |
| A-06 | Audio VAD samples analyser at blob callback time rather than analysing blob frames | Audio/question capture | **High** | Dedicated audio pipeline/worklet with timestamped frames and tested VAD segmentation | High: capture sensitivity |
| A-07 | Silent blobs between words are omitted | Transcription accuracy | **High** | Preserve short intra-utterance silence; trim only leading/trailing silence after segmentation | Medium |
| A-08 | `isProcessingRef` drops a completed question while request is active | Lost interview questions | **High** | Bounded queue with question IDs; optionally cancel obsolete speculative work, never silently discard finals | Medium |
| A-09 | Cleanup closure from `detectAudioActivity` is ignored | Timer/source leak after stop/restart | **High** | Own every disposer in session resources and execute idempotently in `finally`/unmount | Low |
| A-10 | `startCapture` has no synchronous state guard and async acquisition can overlap | Duplicate streams/recorders | **High** | State-machine transition guard plus in-flight initialization token | Medium |
| A-11 | Stop does not abort active fetch/AI/STT and late responses can update new/ended sessions | Race/stale answers/token waste | **High** | AbortController end-to-end plus session/question/request IDs and stale-event rejection | Medium/high |
| A-12 | Combined HTTP request waits for full STT and LLM; UI polls every two seconds | Latency and responsiveness | **High** | Separate transcript ingestion and answer stream; emit start/chunk/complete events; measure TTFT | High: protocol change |
| A-13 | No partial/final transcript model, sequence, dedupe, ordering, or replay protection | Transcript/context correctness | **High** | Typed transcript events and per-session monotonic sequence reconciliation | Medium |
| A-14 | Free-form transcript is sent as normal user content without an explicit untrusted-data policy boundary | Prompt injection | **High** | Versioned prompt policy with system/application/candidate/transcript delimiters and no instruction authority for transcript | Medium: answer style |
| A-15 | Renderer stores access and refresh tokens in `localStorage` | XSS/renderer compromise impact | **High** | Prefer main-process/OS credential storage or secure HttpOnly same-origin cookie strategy; add CSP | Medium/high: auth transport |
| A-16 | Electron per-window permission handlers allow geolocation, MIDI, notifications, etc. without origin checks and override stricter defaults | Desktop security | **High** | One session-level origin-aware handler allowing only required media/display capture | Medium: permission UX |
| A-17 | `sandbox: true` and navigation/window-open restrictions are absent | Electron renderer security | **High** | Enable sandbox; deny unexpected navigation/new windows; validate remote backend origin | Medium |
| A-18 | Upload middleware has no explicit audio/image size/MIME/signature limits and filenames use timestamps | DoS/file handling | **High** | Tight limits, allowlists/magic-byte validation, cryptographic IDs, guaranteed deletion | Medium |
| A-19 | Temp cleanup catches and ignores errors; repository currently contains many upload artifacts | Sensitive retention | **High** | Private OS temp dir, restrictive permissions, per-request `finally`, observable janitor, retention policy | Low/medium |
| A-20 | README and Electron logs claim protection is enabled/universal without capability verification | Stealth/privacy UX | **High** | Capability state machine, honest warning, platform matrix, capture-mode testing | Low |
| A-21 | Main window remains unprotected while user may share entire screen | Accidental exposure | **High** | Protect eligible windows where supported and warn/compact/hide main UI; never claim guarantee | Medium |
| A-22 | No external-share detection exists; `getDisplayMedia` only tracks capture initiated by this app | Stealth state | **Medium** | Represent `UNKNOWN`; consume only supported local capture events; fail safe when protection unknown | Low |
| A-23 | Production CJS bundle contains `import.meta.url` from `load-env.ts` | Production env loading/runtime | **High** | Avoid `import.meta` in CJS or emit ESM; test built artifact startup | Low |
| A-24 | Manual migration cannot evolve existing tables/indexes and schema permits nullable ownership | Data integrity | **High** | Versioned migrations, NOT NULL ownership for durable interview entities, indexes and cascade policy | High: existing DB migration |
| A-25 | Logout revokes any supplied refresh token without checking requesting user | Auth session ownership | **Medium** | Revoke by token + user ID, rotate refresh tokens, store hashes | Low |
| A-26 | Optional auth silently ignores invalid bearer tokens | Ambiguous authorization | **Medium** | Guest mode must be explicit; invalid supplied token should not silently downgrade on sensitive routes | Medium |
| A-27 | Generic global rate limit only; retries repeat all errors except string-matched cases | Request storms and duplicate cost | **High** | Per-operation/user/session limits; typed retryability; idempotency keys; no retry for 4xx/auth/validation | Medium |
| A-28 | Route catches expose provider `err.message` and use `any` | Information disclosure/inconsistent errors | **Medium** | Typed domain errors, stable public codes, internal cause logging with redaction | Medium |
| A-29 | Context history is fetched globally, duplicated, and older content is merely truncated into strings | Privacy/context quality/token growth | **High** | Session-scoped ContextManager with token budget, factual profile, recent finals, durable summary, relevant retrieval | Medium/high |
| A-30 | Resume/profile data is stored plaintext and included wholesale in prompts | Sensitive data exposure | **High** | Consent/provider disclosure, data minimization, local encryption/retention controls, structured fact selection | High: data migration/UX |
| A-31 | Session model is `isActive` boolean only; capture state is `idle/capturing/error` | Impossible/racy states | **High** | Explicit session and connection state machines with guarded events and error subtypes | Medium/high |
| A-32 | Message combines transcript and answer; no question/answer IDs/status | Stale overwrite/idempotency | **High** | Separate TranscriptSegment, InterviewQuestion, GeneratedAnswer with cryptographic IDs/status | High: API/schema migration |
| A-33 | Legacy Replit modules reference removed schema and duplicate routes | Typecheck/build drift | **Medium** | Remove unregistered scaffold after reference confirmation; do not patch dead code into false health | Low |
| A-34 | macOS Electron build is unsigned (`identity: null`); no CI/sign/notarize evidence | Distribution/update trust | **High** | Signed/notarized per-platform CI releases and update signature verification | Medium/operational |
| A-35 | Python sidecar uses fixed six-second chunks, unauthenticated calls, infinite retry, Tkinter cross-thread access | Alternate product path | **High** | Remove or isolate as unsupported experiment; do not maintain two production pipelines | Low if unused |
| A-36 | Client bundle is 501 KB minified and long histories render as one list | Startup/long-session performance | **Medium** | Route-level code splitting and transcript/answer virtualization after correctness work | Low/medium |
## Security and Privacy Audit

### Existing positives

- API keys remain server-side in the inspected TypeScript flow.
- Electron uses `nodeIntegration: false` and `contextIsolation: true`.
- Passwords are hashed with bcrypt.
- Invalid credentials use a generic response.
- Access tokens expire after 15 minutes; refresh tokens are opaque and persisted.
- Session read/update routes perform an ownership check.
- Resume uploads use memory storage with a 5 MB limit and MIME-based parser selection.
- SQLite enables foreign keys and WAL.
- The app binds the server to loopback.

### Required remediation

- Stop all sensitive response-body and content logging before broader testing.
- Enforce authentication and ownership on every interview, AI, transcript, screen, message, and billing operation.
- Add CSP and Electron navigation/window/origin restrictions; eliminate overbroad permission grants.
- Validate every HTTP/form/realtime/provider boundary with Zod or equivalent and limit message/upload sizes.
- Treat transcripts/screens/resumes as untrusted, sensitive inputs. Prompts must explicitly state they cannot override policy.
- Define consent, external-provider disclosure, data retention, export, deletion, and local encryption behavior.
- Move database/uploads to Electron `app.getPath('userData')` or another private application-data location.
- Do not expose API keys, provider stack traces, prompt text, raw audio, full transcript, resume, or response bodies in logs.
- Add per-user/session/operation rate limits and cryptographically safe IDs/idempotency keys.

## Target Architecture Adapted to This Repository

Do not introduce a second framework or database. Evolve the existing React + Express + Electron + SQLite application through these boundaries:

```text
Electron Desktop Runtime
├── BackendProcessManager + secure capability IPC
└── React renderer
    ├── InterviewSessionStore (state machine)
    ├── AudioCaptureService (resource ownership/device lifecycle)
    ├── RealtimeClient (typed authenticated event protocol)
    └── Transcript/Question/Answer views keyed by stable IDs

Express application
├── SessionController -> InterviewSessionService
├── TranscriptController/RealtimeGateway
├── TranscriptPipeline -> TranscriptionService -> STTProvider
├── QuestionPipeline -> QuestionDetector/Classifier
├── ContextManager -> CandidateProfile + bounded session context
├── AnswerPipeline -> PromptBuilder -> AIProvider -> ResponseParser
├── Accessors -> SQLite/Drizzle
└── Redacted logger + metrics + error mapper + configuration
```

Initial transport recommendation: authenticated **SSE for server-to-renderer answer/transcript events plus explicit HTTP commands/uploads**, unless bidirectional streaming STT requires WebSocket after provider selection. Do not add WebSocket merely because `ws` is installed. The protocol must use `sessionId`, `transcriptEventId`, `sequenceNumber`, `questionId`, `answerId`, and `requestId`.

## Baseline Validation

Executed from repository root on 2026-08-30:

| Command | Result | Evidence |
|---|---|---|
| `npm run check` | **FAIL** | 19 TypeScript errors in six legacy Replit integration files; schema mismatch, Express param typing, old `p-retry` API, nullable provider output |
| `npm test -- --runInBand` | **FAIL** | Preservation simulation suite: 8 passing; `bug-exploration.test.ts`: no Jest tests, so suite fails |
| `npm run build` | **PASS with warnings** | 501.31 KB client JS chunk; CJS bundle warns `import.meta` is empty in `server/load-env.ts`; server bundle 1.6 MB |
| `git status --short` | Existing worktree already dirty | Numerous modified/untracked files predate this audit; audit did not overwrite them |

The passing tests do not validate product behavior: they call local `simulate*` functions rather than `useAudioCapture`, Electron, Express, storage, or providers. The bug exploration file only logs stale assertions and contains no `test()` calls. Jest is configured to inspect only `client/src/__tests__`, so backend/Electron tests would not run even if added elsewhere.

No ESLint script/config, browser test runner, Electron test runner, integration suite, E2E suite, coverage gate, project CI workflow, or project Dockerfile was found.

## Stealth Capability Matrix (Current State)

| Platform / app | Capture type | Can detect sharing? | Can prevent capture? | Guaranteed invisible? | Current fallback |
|---|---|---:|---:|---:|---|
| Electron + macOS | External app, entire display | No | Overlay requests content protection; capture-stack dependent | **No** | None beyond README advice |
| Electron + macOS | External app, app window | No | Depends on selected source and conferencing implementation | **No** | None |
| Electron + Windows | External app, entire display/window | No | Overlay requests content protection; OS/version/capture dependent | **No** | None |
| Electron + Linux | External app capture | No | No implemented exclusion | **No** | None |
| Chromium browser/PiP | Browser tab selected by user | Only for capture initiated via this app | Selecting a different tab can avoid UI; page cannot exclude itself universally | **No** | UI warning to share one tab/window |
| Zoom/Meet/Teams/Webex | Any capture initiated by that app | Not universally | Platform/app/source dependent and untested | **No** | Unsupported universal claims in README |
| This app's `getDisplayMedia` | User-selected source | Yes: track start/end only | Can warn based on selected track metadata where exposed | **No** | Stops local capture when audio track ends |

Required behavior is an explicit capability/state model (`NORMAL`, `STEALTH_ENABLED`, `SCREEN_SHARE_DETECTED`, `STEALTH_ACTIVE`, `STEALTH_UNAVAILABLE`) that reports unknown/unavailable rather than promising invisibility. Test every supported OS/conferencing app/capture type separately before documenting a guarantee.

## Smallest Safe Implementation Sequence

1. **Stabilize and contain:** preserve current APIs; remove response-body logging, enforce config validation, quarantine dead integrations, restore green typecheck/tests/build-start smoke test.
2. **Fix ownership/security:** require auth and `{userId, sessionId}` across messages/audio/screen/context; version DB migrations; define guest-mode policy or remove implicit guest access.
3. **Desktop lifecycle:** Electron-managed backend process/port/health/cleanup; restrictive permissions/sandbox/navigation; app-data paths; honest stealth capability IPC.
4. **Domain model and state machine:** add typed session states/events and separate transcript/question/answer entities with stable IDs and statuses.
5. **Audio service:** isolate capture, feature-detect APIs/MIME, support device/end/suspend events, idempotent start/stop, complete cleanup, tested segmentation, bounded queue.
6. **Transcription boundary:** provider interface, partial/final events, sequencing/dedupe/reconciliation, timeouts/errors/retries, no UI-vendor coupling.
7. **Question/context pipeline:** stable-final debounce, confidence/category, session-scoped bounded context, structured candidate facts, safe prompt boundaries.
8. **AI boundary and streaming:** provider abstraction, typed errors, AbortController, request association, prompt versions, structured answer parser, TTFT/latency metrics.
9. **Realtime/recovery:** authenticated typed protocol, bounded reconnect/backoff, replay/idempotency, stale-answer rejection, session recovery rules.
10. **Long-session UI/performance:** keyed transcript/answers, virtualization, bounded state, copy/regenerate/retry/accessibility/status indicators.
11. **Stealth validation:** capability state/fail-safe warning/configurable shortcut and real platform/capture matrix; no unsupported claims.
12. **Production gates/docs:** real unit/integration/realtime/UI/E2E/failure-injection tests, CI, signed packages, updated operational/privacy documentation.

Each phase must keep typecheck, tests, built-server smoke test, and production build green. Database and API migrations should be additive first; delete compatibility paths only after caller and data migration verification.

## Audit Decision

A giant rewrite is not justified. Preserve the UI framework, Electron shell concept, local SQLite approach, basic account/session features, resume parsing, and shared Zod contracts. Replace the unsafe orchestration seams in a sequence beginning with privacy/ownership/configuration and baseline build health. Realtime streaming, richer state, and stealth UX should be built only after those foundations are trustworthy.

### Before -> Intended After

| Before | Intended after |
|---|---|
| One monolithic upload/STT/prompt/AI/save route | Layered transcript and answer pipelines behind provider interfaces |
| Global/nullable message ownership | Session-scoped tenant-safe entities and accessors |
| Batch completion + two-second polling | Typed incremental events and streamed answers |
| Ad-hoc booleans/refs | Explicit session/connection/stealth state machines |
| Dropped concurrent questions and stale requests | Bounded queue, cancellation, stable IDs, stale-result rejection |
| Sensitive console/response logging | Redacted structured logs, metrics, and correlation IDs |
| Claimed universal stealth | Tested best-effort capability matrix with fail-safe warnings |
| Simulation-only tests and red typecheck | Product unit/integration/E2E/failure-injection quality gates |
