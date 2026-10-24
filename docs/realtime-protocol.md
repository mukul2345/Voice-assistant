# Realtime Protocol (Phase 3)

This document specifies the version-1 realtime event contract used by the interview
session core, plus the sequencing (buffering / dedupe / replay) and transcript
reconciliation policies. The contract is transport-independent: it describes the
events themselves, not any particular WebSocket/SSE/WebRTC channel (none of which are
implemented in Phase 3).

Source of truth:
- `shared/interview/RealtimeProtocol.ts` — event schemas and factory.
- `shared/interview/RealtimeEventSequencer.ts` — ordering and dedupe.
- `shared/interview/TranscriptReconciler.ts` — partial/final reconciliation.

---

## 1. Envelope

Every event shares strict common metadata (unknown fields are rejected):

| Field | Type | Notes |
|---|---|---|
| `version` | literal `1` | `REALTIME_PROTOCOL_VERSION` |
| `eventId` | UUID | cryptographic (`globalThis.crypto.randomUUID()`) |
| `sessionId` | string (1–128) | existing numeric DB session id as a bounded string |
| `timestamp` | int ≥ 0 | epoch milliseconds |
| `sequenceNumber` | int ≥ 0 | per-session monotonic outbound ordering |
| `type` | enum | discriminant (see below) |
| `payload` | object | strict, type-specific |

Constraints:
- Maximum serialized event size is **64 KiB** (`MAX_REALTIME_EVENT_BYTES`); larger
  events raise `RealtimeProtocolError(EVENT_TOO_LARGE)`.
- Schemas are `zod` strict discriminated unions; malformed input raises
  `RealtimeProtocolError(MALFORMED_EVENT)` with no content disclosure.
- `eventId`, `segmentId`, `questionId`, `answerId`, `requestId` are UUIDs.
- Failure/cancellation codes match `^[A-Z][A-Z0-9_]{0,63}$` and never carry raw
  provider details.

Identifiers are browser-safe: they use `globalThis.crypto` and `TextEncoder`, with no
Node-only APIs, `any`, or non-null assertions in shared modules.

---

## 2. Event types

| Type | Payload | Purpose |
|---|---|---|
| `SESSION_STATE_CHANGED` | `{ status }` | session status transition |
| `TRANSCRIPT_PARTIAL` | `{ segmentId, speaker, text }` | replaceable partial |
| `TRANSCRIPT_FINAL` | `{ segmentId, speaker, text }` | immutable final |
| `QUESTION_DETECTED` | `{ questionId, segmentId, text }` | new question |
| `QUESTION_STATE_CHANGED` | `{ questionId, status }` | question lifecycle |
| `ANSWER_STARTED` | `{ questionId, answerId, requestId }` | streaming began |
| `ANSWER_CHUNK` | `{ questionId, answerId, requestId, text }` | one chunk |
| `ANSWER_COMPLETED` | `{ questionId, answerId, requestId }` | streaming done |
| `ANSWER_FAILED` | `{ ...identity, code }` | safe failure code |
| `ANSWER_CANCELLED` | `{ ...identity, code }` | safe cancellation code |
| `ERROR` | `{ code, message, retryable, requestId? }` | safe error |

Outbound events are always produced by `createRealtimeEvent`, which generates fresh
`version`, `eventId`, and `timestamp`. Forwarded transcript events are re-emitted with
**fresh outbound metadata** and a new `sequenceNumber`, never the provider's original
identifiers.

---

## 3. Event flow

```
provider / transcription source
        │  (untrusted inbound event)
        ▼
Coordinator.ingestTranscriptEvent(userId, sessionId, event)
        │  ownership recheck + session/type validation
        ▼
RealtimeEventSequencer.sequence(event)  ── orders by sequenceNumber
        │  released events (contiguous)
        ▼
TranscriptReconciler.reconcile(event)   ── partial/final policy
        │  released events forwarded once, in semantic order
        ▼
InterviewEventPublisher.publish(...)     ── fresh metadata, bounded queue
        │
        ▼
InterviewRealtimeTransport.send(event)   ── abstraction (mock in Phase 3)
        │
        ▼
Frontend InterviewSessionStore.ingest(event)
        │  parse → sequence → apply → snapshot
        ▼
React via useInterviewSession (useSyncExternalStore)
```

---

## 4. Sequencing policy (buffering / dedupe / replay)

`RealtimeEventSequencer` orders one session's events by `sequenceNumber` with bounded
memory:

- **Cross-session:** events whose `sessionId` differs are `REJECTED_SESSION`.
- **Duplicate:** a repeated `eventId` or `sequenceNumber` (already released or already
  buffered) is `DUPLICATE` and dropped.
- **Stale:** a `sequenceNumber` below the next expected number is `STALE` and dropped.
- **In-order:** a matching `sequenceNumber` is `RELEASED`; the sequencer then
  iteratively releases any now-contiguous buffered events.
- **Future / gap:** a higher `sequenceNumber` within `maxSequenceGap` is `BUFFERED`
  with the list of missing numbers; beyond the gap it is `REJECTED_GAP`.
- **Capacity:** when the buffer is full it returns `REJECTED_CAPACITY` rather than
  growing unbounded.

Replay example (arrival order `101, 103, 102`, expecting `101`):

```
recv 101 → RELEASED [101]   (next expected 102)
recv 103 → BUFFERED  {103}  (missing: [102])
recv 102 → RELEASED [102, 103]   (102 then the buffered 103)
```

Bounds: `maxBufferedEvents` (default 128), `maxRememberedEvents` (default 1024),
`maxSequenceGap` (default 128). Released-event identity/sequence memory is trimmed in
FIFO order. Release is **iterative**, never recursive.

---

## 5. Transcript reconciliation (partial vs final)

`TranscriptReconciler` maintains stable segments keyed by `segmentId`:

```
PARTIAL(segmentId=S, "hel")   → segment S = "hel"   (not final)
PARTIAL(segmentId=S, "hello") → segment S = "hello" (replaced, not appended)
FINAL(segmentId=S,   "hello") → segment S = "hello" (final, immutable)
PARTIAL(segmentId=S, "hi")    → ignored (final wins over late partial)
```

Policy:
- Partials **replace** the current text for their segment; they are not appended as
  independent messages.
- A final segment is authoritative and can never be overwritten by a later partial.
- Only final segments are exposed for durable persistence
  (`getPersistableFinalSnapshots`); partials are never persisted as durable
  conversation history.
- Duplicate provider events are ignored, sessions are isolated, and retained segments
  are bounded (`maxRetainedSegments`).

---

## 6. Security properties

- **Ownership:** the transport is created per session behind the coordinator's
  ownership recheck; events are only produced for an owned, initialized session.
- **No content in logs:** lifecycle metrics carry IDs, status, and safe codes only —
  never transcript text, question text, answer text, prompts, tokens, or PII.
- **Safe codes only:** `ANSWER_FAILED` / `ANSWER_CANCELLED` / `ERROR` payloads use
  validated uppercase codes; raw provider errors are mapped to generic safe codes such
  as `ANSWER_PROVIDER_FAILED` and `ANSWER_TIMEOUT`.
- **Strict validation:** unknown payload fields are rejected; oversized events are
  rejected before processing.
- **Stale/mismatch rejection:** answer chunk/terminal events must match the active
  `sessionId + questionId + answerId + requestId`; otherwise they are ignored on both
  server and client.

---

## 7. Known limitations and Phase 4 extension points

- No concrete transport binding (WebSocket/SSE/WebRTC) or STT/AI provider exists yet;
  Phase 3 ships abstractions plus in-memory mocks only.
- The frontend store consumes the contract but is not wired to a live connection or
  audio capture.

A Phase 4 transport must: preserve per-session monotonic `sequenceNumber`, honor the
64 KiB size limit, generate fresh UUID `eventId`s, and only ever emit the safe codes
defined here. See `docs/interview-session-architecture.md` for the orchestration and
ownership context.
