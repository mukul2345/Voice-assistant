import { describe, expect, it } from '@jest/globals';

import { InterviewSessionStatus, QuestionStatus } from '../../shared/interview/InterviewSession';
import {
    RealtimeEventSequencer,
    SequencerDisposition,
} from '../../shared/interview/RealtimeEventSequencer';
import {
    createRealtimeEvent,
    createRealtimeId,
    MAX_REALTIME_EVENT_BYTES,
    parseRealtimeEvent,
    RealtimeEvent,
    RealtimeEventType,
    RealtimeProtocolErrorCode,
    serializeRealtimeEvent,
    Speaker,
} from '../../shared/interview/RealtimeProtocol';

const SESSION_ID = '1';
const SEGMENT_ID = createRealtimeId();

function createTranscriptEvent(
    sequenceNumber: number,
    type: RealtimeEventType.TRANSCRIPT_PARTIAL | RealtimeEventType.TRANSCRIPT_FINAL =
        RealtimeEventType.TRANSCRIPT_PARTIAL,
    sessionId = SESSION_ID,
): RealtimeEvent {
    if (type === RealtimeEventType.TRANSCRIPT_FINAL) {
        return createRealtimeEvent({
            type,
            sessionId,
            sequenceNumber,
            payload: { segmentId: SEGMENT_ID, speaker: Speaker.INTERVIEWER, text: 'Final text' },
        });
    }
    return createRealtimeEvent({
        type,
        sessionId,
        sequenceNumber,
        payload: { segmentId: SEGMENT_ID, speaker: Speaker.INTERVIEWER, text: 'Partial text' },
    });
}

describe('RealtimeProtocol', () => {
    it('should generate UUID event IDs, integer epoch timestamps, and round-trip valid events', () => {
        const firstEvent = createTranscriptEvent(1);
        const secondEvent = createTranscriptEvent(2);
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        expect(firstEvent.version).toBe(1);
        expect(firstEvent.sessionId).toBe('1');
        expect(firstEvent.eventId).toMatch(uuidPattern);
        expect(secondEvent.eventId).not.toBe(firstEvent.eventId);
        expect(Number.isInteger(firstEvent.timestamp)).toBe(true);
        expect(firstEvent.timestamp).toBeGreaterThanOrEqual(0);
        expect(parseRealtimeEvent(serializeRealtimeEvent(firstEvent))).toEqual(firstEvent);
    });

    it('should accept every explicit lifecycle event with required identifiers', () => {
        const questionId = createRealtimeId();
        const answerId = createRealtimeId();
        const requestId = createRealtimeId();
        const answerIdentity = { questionId, answerId, requestId };
        const events: RealtimeEvent[] = [
            createRealtimeEvent({
                type: RealtimeEventType.SESSION_STATE_CHANGED,
                sessionId: SESSION_ID,
                sequenceNumber: 1,
                payload: { status: InterviewSessionStatus.RECORDING },
            }),
            createTranscriptEvent(2, RealtimeEventType.TRANSCRIPT_PARTIAL),
            createTranscriptEvent(3, RealtimeEventType.TRANSCRIPT_FINAL),
            createRealtimeEvent({
                type: RealtimeEventType.QUESTION_DETECTED,
                sessionId: SESSION_ID,
                sequenceNumber: 4,
                payload: {
                    questionId,
                    segmentId: SEGMENT_ID,
                    text: 'What is deterministic ordering?',
                },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.QUESTION_STATE_CHANGED,
                sessionId: SESSION_ID,
                sequenceNumber: 5,
                payload: { questionId, status: QuestionStatus.ANSWERING },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ANSWER_STARTED,
                sessionId: SESSION_ID,
                sequenceNumber: 6,
                payload: answerIdentity,
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ANSWER_CHUNK,
                sessionId: SESSION_ID,
                sequenceNumber: 7,
                payload: { ...answerIdentity, text: 'Bound each reorder buffer.' },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ANSWER_COMPLETED,
                sessionId: SESSION_ID,
                sequenceNumber: 8,
                payload: answerIdentity,
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ANSWER_FAILED,
                sessionId: SESSION_ID,
                sequenceNumber: 9,
                payload: { ...answerIdentity, code: 'PROVIDER_TIMEOUT' },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ANSWER_CANCELLED,
                sessionId: SESSION_ID,
                sequenceNumber: 10,
                payload: { ...answerIdentity, code: 'USER_CANCELLED' },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.ERROR,
                sessionId: SESSION_ID,
                sequenceNumber: 11,
                payload: {
                    code: 'PROVIDER_UNAVAILABLE',
                    message: 'Try again.',
                    retryable: true,
                    requestId,
                },
            }),
        ];

        expect(Object.values(RealtimeEventType)).toEqual([
            'SESSION_STATE_CHANGED',
            'TRANSCRIPT_PARTIAL',
            'TRANSCRIPT_FINAL',
            'QUESTION_DETECTED',
            'QUESTION_STATE_CHANGED',
            'ANSWER_STARTED',
            'ANSWER_CHUNK',
            'ANSWER_COMPLETED',
            'ANSWER_FAILED',
            'ANSWER_CANCELLED',
            'ERROR',
        ]);
        expect(events.map(({ type }) => type)).toEqual(Object.values(RealtimeEventType));
        for (const event of events) {
            expect(parseRealtimeEvent(serializeRealtimeEvent(event))).toEqual(event);
            if (event.type.startsWith('ANSWER_')) {
                expect(event.payload).toEqual(expect.objectContaining(answerIdentity));
            }
        }
    });

    it('should require UUID entity IDs while accepting bounded established session IDs', () => {
        const validEvent = createTranscriptEvent(1);

        expect(parseRealtimeEvent({ ...validEvent, sessionId: '1' }).sessionId).toBe('1');
        expect(() => parseRealtimeEvent({ ...validEvent, sessionId: '' })).toThrow(
            expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }),
        );
        expect(() => parseRealtimeEvent({ ...validEvent, sessionId: 'x'.repeat(129) })).toThrow(
            expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }),
        );
        expect(() => parseRealtimeEvent({
            ...validEvent,
            payload: { ...validEvent.payload, segmentId: '1' },
        })).toThrow(expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }));
    });

    it('should reject malformed metadata and unknown strict payload fields', () => {
        const validEvent = createTranscriptEvent(1);

        expect(() => parseRealtimeEvent({ ...validEvent, version: 2 })).toThrow(
            expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }),
        );
        expect(() => parseRealtimeEvent({
            ...validEvent,
            timestamp: new Date().toISOString(),
        })).toThrow(expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }));
        expect(() => parseRealtimeEvent({
            ...validEvent,
            payload: { ...validEvent.payload, privateContext: 'must not cross the wire' },
        })).toThrow(expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }));
        expect(() => parseRealtimeEvent('{not-json')).toThrow(
            expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }),
        );
    });

    it('should reject serialized events larger than 64 KiB using UTF-8 byte length', () => {
        const oversizedEvent = {
            ...createTranscriptEvent(1),
            payload: {
                segmentId: SEGMENT_ID,
                speaker: Speaker.UNKNOWN,
                text: '🙂'.repeat(MAX_REALTIME_EVENT_BYTES),
            },
        };
        const serializedEvent = JSON.stringify(oversizedEvent);

        expect(new TextEncoder().encode(serializedEvent).byteLength).toBeGreaterThan(
            MAX_REALTIME_EVENT_BYTES,
        );
        expect(() => parseRealtimeEvent(serializedEvent)).toThrow(
            expect.objectContaining({ code: RealtimeProtocolErrorCode.EVENT_TOO_LARGE }),
        );
    });

    it.each([
        RealtimeEventType.ANSWER_FAILED,
        RealtimeEventType.ANSWER_CANCELLED,
    ])('should reject raw details on %s events', (type) => {
        const answerIdentity = {
            questionId: createRealtimeId(),
            answerId: createRealtimeId(),
            requestId: createRealtimeId(),
        };
        const event = type === RealtimeEventType.ANSWER_FAILED
            ? createRealtimeEvent({
                type: RealtimeEventType.ANSWER_FAILED,
                sessionId: SESSION_ID,
                sequenceNumber: 1,
                payload: { ...answerIdentity, code: 'SAFE_CODE' },
            })
            : createRealtimeEvent({
                type: RealtimeEventType.ANSWER_CANCELLED,
                sessionId: SESSION_ID,
                sequenceNumber: 1,
                payload: { ...answerIdentity, code: 'SAFE_CODE' },
            });

        expect(() => parseRealtimeEvent({
            ...event,
            payload: { ...event.payload, details: 'sensitive provider details' },
        })).toThrow(expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }));
    });

    it('should reject unsafe fields on general error events', () => {
        const errorEvent = createRealtimeEvent({
            type: RealtimeEventType.ERROR,
            sessionId: SESSION_ID,
            sequenceNumber: 1,
            payload: { code: 'PROVIDER_TIMEOUT', message: 'Try again.', retryable: true },
        });

        expect(() => parseRealtimeEvent({
            ...errorEvent,
            payload: { ...errorEvent.payload, stack: 'sensitive stack' },
        })).toThrow(expect.objectContaining({ code: RealtimeProtocolErrorCode.MALFORMED_EVENT }));
    });
});

describe('RealtimeEventSequencer', () => {
    it('should release 101, 103, 102 as 101, then 102 and 103', () => {
        const sequencer = new RealtimeEventSequencer({
            sessionId: SESSION_ID,
            initialSequenceNumber: 100,
        });
        const event101 = createTranscriptEvent(101);
        const event103 = createTranscriptEvent(103);
        const event102 = createTranscriptEvent(102);

        expect(sequencer.sequence(event101).releasedEvents.map(({ sequenceNumber }) => sequenceNumber))
            .toEqual([101]);
        const missingResult = sequencer.sequence(event103);
        expect(missingResult.disposition).toBe(SequencerDisposition.BUFFERED);
        expect(missingResult.missingSequenceNumbers).toEqual([102]);
        expect(sequencer.sequence(event102).releasedEvents.map(({ sequenceNumber }) => sequenceNumber))
            .toEqual([102, 103]);
    });

    it('should classify duplicate sequence numbers, duplicate IDs, and stale events', () => {
        const sequencer = new RealtimeEventSequencer({
            sessionId: SESSION_ID,
            maxRememberedEvents: 1,
        });
        const firstEvent = createTranscriptEvent(1);
        expect(sequencer.sequence(firstEvent).disposition).toBe(SequencerDisposition.RELEASED);
        expect(sequencer.sequence(firstEvent).disposition).toBe(SequencerDisposition.DUPLICATE);

        const duplicateSequence = createTranscriptEvent(1);
        expect(sequencer.sequence(duplicateSequence).disposition).toBe(
            SequencerDisposition.DUPLICATE,
        );
        expect(sequencer.sequence(createTranscriptEvent(2)).disposition).toBe(
            SequencerDisposition.RELEASED,
        );
        expect(sequencer.sequence(firstEvent).disposition).toBe(SequencerDisposition.STALE);
        expect(sequencer.rememberedEventCount).toBe(1);
    });

    it('should reject cross-session, excessive-gap, and over-capacity events', () => {
        const sequencer = new RealtimeEventSequencer({
            sessionId: SESSION_ID,
            maxBufferedEvents: 1,
            maxSequenceGap: 3,
        });

        expect(sequencer.sequence(createTranscriptEvent(1, undefined, createRealtimeId())).disposition)
            .toBe(SequencerDisposition.REJECTED_SESSION);
        expect(sequencer.sequence(createTranscriptEvent(5)).disposition).toBe(
            SequencerDisposition.REJECTED_GAP,
        );
        expect(sequencer.sequence(createTranscriptEvent(2)).disposition).toBe(
            SequencerDisposition.BUFFERED,
        );
        expect(sequencer.sequence(createTranscriptEvent(3)).disposition).toBe(
            SequencerDisposition.REJECTED_CAPACITY,
        );
        expect(sequencer.bufferedEventCount).toBe(1);
    });

    it('should release a long buffered run iteratively without recursive processing', () => {
        const eventCount = 250;
        const sequencer = new RealtimeEventSequencer({
            sessionId: SESSION_ID,
            maxBufferedEvents: eventCount,
            maxSequenceGap: eventCount,
        });
        for (let sequenceNumber = eventCount; sequenceNumber >= 2; sequenceNumber -= 1) {
            sequencer.sequence(createTranscriptEvent(sequenceNumber));
        }

        const releasedResult = sequencer.sequence(createTranscriptEvent(1));
        expect(releasedResult.releasedEvents).toHaveLength(eventCount);
        expect(releasedResult.releasedEvents.at(-1)?.sequenceNumber).toBe(eventCount);
    });
});