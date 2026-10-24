import { describe, expect, it } from '@jest/globals';

import { InterviewSessionStatus, QuestionStatus, AnswerStatus } from '@shared/interview/InterviewSession';
import {
    createRealtimeEvent,
    createRealtimeId,
    RealtimeEventType,
    Speaker,
} from '@shared/interview/RealtimeProtocol';
import {
    InterviewAudioStatus,
    InterviewConnectionStatus,
    InterviewSessionStore,
} from '../interview/InterviewSessionStore';

const SESSION_ID = '1';

function sessionState(status: InterviewSessionStatus, sequenceNumber: number) {
    return createRealtimeEvent({
        type: RealtimeEventType.SESSION_STATE_CHANGED,
        sessionId: SESSION_ID,
        sequenceNumber,
        payload: { status },
    });
}

describe('InterviewSessionStore', () => {
    it('should derive UI booleans from session status rather than independent flags', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });

        expect(store.getSnapshot().sessionStatus).toBe(InterviewSessionStatus.CREATED);
        expect(store.getSnapshot().canStart).toBe(false);

        store.ingest(sessionState(InterviewSessionStatus.READY, 1));
        expect(store.getSnapshot()).toMatchObject({
            sessionStatus: InterviewSessionStatus.READY,
            canStart: true,
            canStop: true,
            isRecording: false,
            isBusy: false,
            isTerminal: false,
        });

        store.ingest(sessionState(InterviewSessionStatus.RECORDING, 2));
        expect(store.getSnapshot().isRecording).toBe(true);

        store.ingest(sessionState(InterviewSessionStatus.STOPPING, 3));
        store.ingest(sessionState(InterviewSessionStatus.COMPLETED, 4));
        expect(store.getSnapshot()).toMatchObject({
            isTerminal: true,
            canStop: false,
            isRecording: false,
        });
    });

    it('should track connection and audio status independently of session status', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });

        store.setConnectionStatus(InterviewConnectionStatus.CONNECTED);
        store.setAudioStatus(InterviewAudioStatus.CAPTURING);

        expect(store.getSnapshot()).toMatchObject({
            connectionStatus: InterviewConnectionStatus.CONNECTED,
            audioStatus: InterviewAudioStatus.CAPTURING,
            sessionStatus: InterviewSessionStatus.CREATED,
        });
    });

    it('should replace partials and clear them once a final segment arrives', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });
        const segmentId = createRealtimeId();

        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.TRANSCRIPT_PARTIAL,
            sessionId: SESSION_ID,
            sequenceNumber: 1,
            payload: { segmentId, speaker: Speaker.INTERVIEWER, text: 'partial one' },
        }));
        expect(store.getSnapshot().currentPartial).toBe('partial one');

        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.TRANSCRIPT_FINAL,
            sessionId: SESSION_ID,
            sequenceNumber: 2,
            payload: { segmentId, speaker: Speaker.INTERVIEWER, text: 'final one' },
        }));
        expect(store.getSnapshot().currentPartial).toBe('');
        expect(store.getSnapshot().transcript).toEqual([
            { segmentId, text: 'final one', isFinal: true },
        ]);
    });

    it('should reject stale and mismatched answer events for a superseded question', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });
        const questionA = createRealtimeId();
        const questionB = createRealtimeId();
        const answerA = { answerId: createRealtimeId(), requestId: createRealtimeId() };
        const answerB = { answerId: createRealtimeId(), requestId: createRealtimeId() };
        const segmentA = createRealtimeId();
        const segmentB = createRealtimeId();

        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.QUESTION_DETECTED,
            sessionId: SESSION_ID,
            sequenceNumber: 1,
            payload: { questionId: questionA, segmentId: segmentA, text: 'Question A' },
        }));
        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.ANSWER_STARTED,
            sessionId: SESSION_ID,
            sequenceNumber: 2,
            payload: { questionId: questionA, ...answerA },
        }));
        // A newer question supersedes A and clears its answer.
        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.QUESTION_DETECTED,
            sessionId: SESSION_ID,
            sequenceNumber: 3,
            payload: { questionId: questionB, segmentId: segmentB, text: 'Question B' },
        }));
        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.ANSWER_STARTED,
            sessionId: SESSION_ID,
            sequenceNumber: 4,
            payload: { questionId: questionB, ...answerB },
        }));
        // Stale chunk for the superseded answer A must be ignored.
        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.ANSWER_CHUNK,
            sessionId: SESSION_ID,
            sequenceNumber: 5,
            payload: { questionId: questionA, ...answerA, text: 'stale A' },
        }));
        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.ANSWER_CHUNK,
            sessionId: SESSION_ID,
            sequenceNumber: 6,
            payload: { questionId: questionB, ...answerB, text: 'fresh B' },
        }));

        expect(store.getSnapshot().currentQuestion).toMatchObject({
            questionId: questionB,
            status: QuestionStatus.DETECTED,
        });
        expect(store.getSnapshot().currentAnswer).toMatchObject({
            answerId: answerB.answerId,
            requestId: answerB.requestId,
            status: AnswerStatus.STREAMING,
            text: 'fresh B',
        });
    });

    it('should drop cross-session events without mutating state', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });

        store.ingest(createRealtimeEvent({
            type: RealtimeEventType.SESSION_STATE_CHANGED,
            sessionId: '999',
            sequenceNumber: 1,
            payload: { status: InterviewSessionStatus.RECORDING },
        }));

        expect(store.getSnapshot().sessionStatus).toBe(InterviewSessionStatus.CREATED);
    });

    it('should surface a safe error for malformed events without throwing', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });

        store.ingest({ not: 'a valid event' });

        expect(store.getSnapshot().error).toMatchObject({ retryable: false });
    });

    it('should notify subscribers on change and stop after unsubscribe', () => {
        const store = new InterviewSessionStore({ sessionId: SESSION_ID });
        const snapshots: InterviewSessionStatus[] = [];
        const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot.sessionStatus));

        store.ingest(sessionState(InterviewSessionStatus.READY, 1));
        unsubscribe();
        store.ingest(sessionState(InterviewSessionStatus.RECORDING, 2));

        expect(snapshots).toEqual([InterviewSessionStatus.READY]);
    });
});
