# Interview Session Architecture (Phase 3)

This document describes the deterministic, provider-independent interview session
core introduced in Phase 3. It covers the session state machine, question/answer
lifecycle, ownership boundary, cancellation and stale-response protection, and the
cleanup guarantees on stop and failure.

Phase 3 deliberately implements **no** real speech-to-text, AI provider, WebSocket,
SSE, WebRTC, or production audio streaming. All external systems are represented by
provider and transport abstractions with in-memory mocks used by tests.

---

## 1. Component overview

```
                         ┌─────────────────────────────────────────────┐
   authenticated caller  │        InterviewSessionCoordinator           │
  (userId + sessionId)   │  public owner-scoped orchestration surface   │
        │                └───────────────┬─────────────────────────────┘
        │                                │
        ▼                                ▼
┌──────────────────┐          ┌──────────────────────┐    ┌──────────────────────┐
│ InterviewSession │          │  InterviewSession     │    │ InterviewCoordinator  │
│ Registry         │◄────────►│  Runtime (per session)│    │ Configuration         │
│ ownership +      │          │  bounded domain state │    │ bounded defaults      │
│ persistence      │          └──────────┬───────────┘    └──────────────────────┘
└────────┬─────────┘                     │
         │                               ▼
         │                    ┌──────────────────────┐
         │                    │ TranscriptReconciler  │ (shared)
         │                    │ RealtimeEventSequencer│ (shared)
         ▼                    └──────────────────────┘
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ InterviewEvent   │   │ InterviewTranscript   │   │ InterviewAnswer       │
│ Publisher        │   │ Pipeline              │   │ Pipeline + Callbacks  │
│ bounded outbound │   │ forward + detect      │   │ request/supersede/    │
│ delivery + drain │   │ questions             │   │ timeout/cancel        │
└────────┬─────────┘   └──────────────────────┘   └──────────┬───────────┘
         │                                                     │
         ▼                                                     ▼
┌──────────────────┐                                ┌──────────────────────┐
│ Interview        │                                │ InterviewAnswer       │
│ RealtimeTransport│  (abstraction + mock only)     │ Provider              │
└──────────────────┘                                │ (abstraction + mock)  │
                                                     └──────────────────────┘
```

Each collaborator is ≤ 300 lines with a single responsibility. The coordinator is a
thin orchestration surface; the registry owns ownership and persistence, the runtime
owns per-session bounded state, and the two pipelines own transcript and answer flows.

---

## 2. Session state machine

Session status is persisted through the ownership boundary (`status` and
`failureCode` columns). All transitions are guarded; terminal states reject further
transitions.

```
        ┌─────────┐
        │ CREATED │
        └────┬────┘
             │ initialize()
             ▼
      ┌──────────────┐
      │ INITIALIZING │──────────────┐
      └──────┬───────┘              │
             │ transport connected  │
             ▼                      │
        ┌────────┐                  │
        │ READY  │────────┐         │
        └───┬────┘        │         │
     start()│             │ stop()  │
            ▼             │         │
     ┌────────────┐       │         │
 ┌──►│ RECORDING  │───────┤         │
 │   └─────┬──────┘       │         │
 │ continue│  ▲ pause     │         │
 │ Recording  │ resume    │         │
 │   ▼     │  │           │         │
 │ ┌────────────┐   ┌────────┐      │
 │ │ PROCESSING │   │ PAUSED │──────┤
 │ └─────┬──────┘   └───┬────┘      │
 └───────┘              │           │
            all active ─┴───────────┤ stop()
            states ─────────────────┤
                                    ▼
                             ┌──────────┐
                             │ STOPPING │
                             └────┬─────┘
                                  ▼
                            ┌───────────┐
                            │ COMPLETED │  (terminal)
                            └───────────┘

Any non-terminal state ──fail(code)──► FAILED (terminal)
```

Notes:
- The exact allowed transitions live in `shared/interview/InterviewSession.ts`.
- `INITIALIZING → FAILED` fires on transport connect timeout or initialization error.
- `fail()` only accepts a validated uppercase safe code (`^[A-Z][A-Z0-9_]{0,63}$`).

---

## 3. Question and answer lifecycle

```
Question:  DETECTED ──► PROCESSING ──► ANSWERING ──► COMPLETED
                └──────────┴─────────────┴──────► FAILED / CANCELLED

Answer:    PENDING ──► STREAMING ──► COMPLETED
               └──────────┴──────► FAILED / CANCELLED
```

- A question is detected only from an existing **final** transcript segment.
- `requestAnswer` moves the question `DETECTED → PROCESSING → ANSWERING`, creates an
  answer with fresh UUIDs (`answerId`, `requestId`), and marks it `STREAMING`.
- Provider chunks append to bounded answer text; completion transitions both the
  answer and its question to `COMPLETED`.

---

## 4. Ownership boundary

```
  request  ──►  Coordinator public method(authenticatedUserId, sessionId, ...)
                      │
                      ▼
             InterviewSessionRegistry
                      │  getSessionForUser(sessionId, userId)
                      ▼
             ┌─────────────────────────┐
             │ owned?  yes │ no         │
             └──────┬──────┴─────┬──────┘
                    │            │
                    ▼            ▼
             continue      InterviewCoordinatorError(SESSION_NOT_FOUND)
                           "The requested session was not found."
```

- Every public coordinator method takes `authenticatedUserId + sessionId` and
  revalidates ownership via `getSessionForUser` on **each** call.
- Foreign ownership always yields a non-disclosing `SESSION_NOT_FOUND`, never a
  distinct "forbidden" signal that would confirm the session exists.
- Persistence goes through `updateSessionForUser(sessionId, userId, updates)`, so a
  tenant can never mutate another tenant's session.
- A compile-time assertion (`InterviewStorageAccessorCompatibility`) proves the real
  `Storage` structurally satisfies the coordinator accessor.

The HTTP layer enforces the same boundary; see
`server/__tests__/interview-http-ownership.test.ts` for a cross-user regression test
against the real routes (`/api/sessions/:id`, `/api/sessions/:id` PUT, and
`/api/messages?sessionId=`), all returning `404` for foreign sessions.

---

## 5. Cancellation and stale-response protection

```
Question A active ──► answer A (requestId Ra, AbortController Ca)
        │
        │ detectQuestion(B) / requestAnswer(B)
        ▼
cancelActiveAnswer('SUPERSEDED'):
   - clear active request marker
   - clear answer A timeout timer
   - Ca.abort()
   - answer A ──► CANCELLED, question A ──► CANCELLED
   - publish ANSWER_CANCELLED (safe code)
        │
        ▼
Question B active ──► answer B (requestId Rb, AbortController Cb)

Late callback for A (chunk/complete/fail):
   runtime.getActiveAnswer(identity) checks
     activeRequestId === Ra?  NO  ──► ignored
```

Every provider callback validates the exact `sessionId + questionId + answerId +
requestId` tuple **and** that the request is still the active one and the session is
still accepting events. Late callbacks after supersession or session stop are dropped.

Each active answer owns an `AbortController` and a timeout timer (default 30s). On
timeout the answer is aborted and transitioned to `FAILED` with code `ANSWER_TIMEOUT`.

---

## 6. Stop and failure cleanup

```
stop():
  transition ──► STOPPING
  runtime.stopAcceptingEvents()
  cancelActiveAnswer('SESSION_STOPPED')   (drains ANSWER_CANCELLED + state events)
  transition ──► COMPLETED
  runtime.clearAllAnswerTimers()
  publisher.close()  (drains queued events, then closes transport once)

fail(code):
  runtime.stopAcceptingEvents()
  cancelActiveAnswer('SESSION_FAILED')     (best-effort)
  transition ──► FAILED (persist safe code)
  finally: clearAllAnswerTimers() + publisher.close()
```

Cleanup guarantees:
- All answer timeout timers are cleared on completion, failure, cancellation, stop,
  and session failure.
- The transport is closed exactly once; `InterviewEventPublisher.close()` first drains
  the in-flight queue, then closes with a bounded timeout and is idempotent.
- Re-initializing an already-open session is rejected with
  `SESSION_ALREADY_INITIALIZED` **before** any second transport is created, so the
  existing transport can never leak.

---

## 7. Bounded-memory guarantees

All retained structures are bounded and cleaned up:

| Structure | Bound |
|---|---|
| Active sessions | `maxSessions` (default 100) |
| Questions per session | `maxQuestionsPerSession` (default 100) |
| Answers per session | `maxAnswersPerSession` (default 100) |
| Transcript segments | `maxTranscriptSegments` (default 100) |
| Outbound event queue | `maxOutboundEvents` (default 256) |
| Answer text | `maxAnswerBytes` (default 64 KiB) |
| Answer chunk | `maxChunkBytes` (default 32 KiB) |
| Sequencer buffer / dedupe | bounded (see realtime protocol doc) |

Eviction only drops **terminal** records; evicting a live record raises
`CAPACITY_EXCEEDED` rather than silently corrupting state.

---

## 8. Frontend session state abstraction

`client/src/interview/InterviewSessionStore.ts` is a browser-safe, framework-agnostic
store; `client/src/hooks/useInterviewSession.ts` binds it to React via
`useSyncExternalStore`.

- Consumes the shared realtime event contract and the shared
  `RealtimeEventSequencer`.
- Rejects malformed events (surfacing a safe error), cross-session events, and stale
  or out-of-order events (dropped by the sequencer).
- Rejects answer chunk/terminal events that do not match the current
  `questionId + answerId + requestId`.
- Derives all UI booleans (`isRecording`, `isBusy`, `canStart`, `canStop`,
  `isTerminal`) from the session status rather than independent mutable flags.
- Tracks connection status and audio status independently of the session status.
- Never controls a WebSocket, MediaRecorder, database, or provider directly.

---

## 9. Electron IPC boundary

Phase 3 adds **no** new Electron IPC. The renderer and main process do not exchange
realtime interview events over IPC in this phase; realtime flow is modeled through the
transport abstraction and remains unimplemented for production.

`electron/preload.cjs` continues to expose only a frozen platform value
(`window.electron.platform`) through the context bridge. No Node APIs are exposed and
no realtime channel was added.

---

## 10. Known limitations and Phase 4 extension points

- No concrete transport (WebSocket/SSE/WebRTC) or STT/AI provider is implemented; only
  abstractions and in-memory mocks exist.
- Partial transcripts are never persisted as durable conversation messages; only final
  transcripts feed persistence, and durable answer history remains on the existing
  request/response path.
- The frontend store consumes events but is not yet wired to a live connection or
  audio capture in `Home.tsx`.

Phase 4 (not implemented here) would add: a concrete realtime transport, real STT and
answer providers behind the existing abstractions, live audio capture wiring, and
end-to-end UI integration. See `docs/realtime-protocol.md` for the wire contract those
implementations must satisfy.
