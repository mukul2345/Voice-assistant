import { describe, expect, it } from '@jest/globals';

import { InterviewSessionStatus } from '../../shared/interview/InterviewSession';
import {
    createRealtimeEvent,
    createRealtimeId,
    RealtimeEvent,
    RealtimeEventType,
    Speaker,
} from '../../shared/interview/RealtimeProtocol';
import { InterviewLifecycleLogName } from '../interview/InterviewSessionCoordinator';
import {
    addInterviewSession as addSession,
    createInterviewCoordinatorHarness as createHarness,
    flushInterviewCallbacks as flushCallbacks,
    ingestFinal,
    initializeRecording,
} from '../interview/testing/InterviewCoordinatorTestHarness';

type TranscriptEvent = Extract<RealtimeEvent, {
    type: RealtimeEventType.TRANSCRIPT_PARTIAL | RealtimeEventType.TRANSCRIPT_FINAL;
}>;

function isTranscriptEvent(event: RealtimeEvent): event is TranscriptEvent {
    return event.type === RealtimeEventType.TRANSCRIPT_PARTIAL
        || event.type === RealtimeEventType.TRANSCRIPT_FINAL;
}

describe('InterviewSessionCoordinator', () => {
    it('should perform required session transitions and reject an invalid transition', async () => {
        const { accessor, coordinator } = createHarness();
        await addSession(accessor, 1, 10);

        await coordinator.initialize(10, 1);
        expect(accessor.sessions.get(1)?.status).toBe(InterviewSessionStatus.READY);
        await coordinator.start(10, 1);
        await coordinator.markProcessing(10, 1);
        await coordinator.continueRecording(10, 1);
        await coordinator.pause(10, 1);
        await coordinator.resume(10, 1);
        await expect(coordinator.start(10, 1)).rejects.toMatchObject({
            code: 'INVALID_TRANSITION',
        });
        await coordinator.stop(10, 1);

        expect(accessor.sessions.get(1)?.status).toBe(InterviewSessionStatus.COMPLETED);
    });

    it('should reject re-initialization of an open session without leaking a transport', async () => {
        const { accessor, transports, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await coordinator.initialize(10, 1);

        await expect(coordinator.initialize(10, 1)).rejects.toMatchObject({
            code: 'SESSION_ALREADY_INITIALIZED',
        });

        expect(transports.createdCount).toBe(1);
        expect(accessor.sessions.get(1)?.status).toBe(InterviewSessionStatus.READY);
    });

    it('should cancel question A and ignore its late callbacks after B completes', async () => {
        const { accessor, provider, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentA = await ingestFinal(coordinator, 10, 1, 1, 'Question A');
        const segmentB = await ingestFinal(coordinator, 10, 1, 2, 'Question B');
        const questionA = await coordinator.detectQuestion(10, 1, segmentA);
        const answerA = await coordinator.requestAnswer(10, 1, questionA.questionId);

        const questionB = await coordinator.detectQuestion(10, 1, segmentB);
        const answerB = await coordinator.requestAnswer(10, 1, questionB.questionId);
        provider.emitChunk(answerB.requestId, 'B answer');
        provider.complete(answerB.requestId);
        provider.emitChunk(answerA.requestId, 'late A');
        provider.complete(answerA.requestId);
        await flushCallbacks();
        const snapshot = await coordinator.getSnapshot(10, 1);

        expect(provider.wasCancelled(answerA.requestId)).toBe(true);
        expect(snapshot.answers.find(({ answerId }) => answerId === answerA.answerId)).toMatchObject({
            questionId: questionA.questionId,
            requestId: answerA.requestId,
            status: 'CANCELLED',
            text: '',
        });
        expect(snapshot.answers.find(({ answerId }) => answerId === answerB.answerId)).toMatchObject({
            questionId: questionB.questionId,
            requestId: answerB.requestId,
            status: 'COMPLETED',
            text: 'B answer',
        });
    });

    it('should ignore late completion after stop and close transport exactly once', async () => {
        const { accessor, provider, transports, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentId = await ingestFinal(coordinator, 10, 1, 1);
        const question = await coordinator.detectQuestion(10, 1, segmentId);
        const answer = await coordinator.requestAnswer(10, 1, question.questionId);

        await coordinator.stop(10, 1);
        provider.complete(answer.requestId);
        await flushCallbacks();
        const snapshot = await coordinator.getSnapshot(10, 1);

        expect(snapshot.status).toBe(InterviewSessionStatus.COMPLETED);
        expect(snapshot.answers[0]?.status).toBe('CANCELLED');
        expect(transports.getTransport('1')?.closeCount).toBe(1);
        expect(provider.wasCancelled(answer.requestId)).toBe(true);
    });

    it('should isolate sessions and deny foreign ownership without revealing existence', async () => {
        const { accessor, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await addSession(accessor, 2, 20);
        await initializeRecording(coordinator, 10, 1);
        await initializeRecording(coordinator, 20, 2);
        const foreignSegmentId = createRealtimeId();
        const sessionAEvent = createRealtimeEvent({
            type: RealtimeEventType.TRANSCRIPT_FINAL,
            sessionId: '1',
            sequenceNumber: 1,
            payload: {
                segmentId: foreignSegmentId,
                speaker: Speaker.INTERVIEWER,
                text: 'Session A only',
            },
        });

        await expect(coordinator.ingestTranscriptEvent(20, 2, sessionAEvent)).rejects.toMatchObject({
            code: 'SESSION_MISMATCH',
        });
        await expect(coordinator.getSnapshot(20, 1)).rejects.toMatchObject({
            code: 'SESSION_NOT_FOUND',
            message: 'The requested session was not found.',
        });
        expect((await coordinator.getSnapshot(20, 2)).transcripts).toEqual([]);
    });

    it('should persist only a safe uppercase failure code and close resources', async () => {
        const { accessor, transports, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);

        await expect(coordinator.fail(10, 1, 'provider details')).rejects.toMatchObject({
            code: 'INVALID_FAILURE_CODE',
        });
        await coordinator.fail(10, 1, 'PROVIDER_UNAVAILABLE');

        expect(accessor.sessions.get(1)).toMatchObject({
            status: InterviewSessionStatus.FAILED,
            failureCode: 'PROVIDER_UNAVAILABLE',
        });
        expect(transports.getTransport('1')?.closeCount).toBe(1);
    });

    it('should bound retained records and answer text', async () => {
        const { accessor, provider, coordinator } = createHarness({
            maxQuestionsPerSession: 2,
            maxAnswersPerSession: 2,
            maxAnswerBytes: 6,
            maxChunkBytes: 4,
        });
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);

        for (let index = 1; index <= 3; index += 1) {
            const segmentId = await ingestFinal(coordinator, 10, 1, index, `Question ${index}`);
            const question = await coordinator.detectQuestion(10, 1, segmentId);
            const answer = await coordinator.requestAnswer(10, 1, question.questionId);
            provider.emitChunk(answer.requestId, 'abc');
            provider.emitChunk(answer.requestId, 'def');
            provider.emitChunk(answer.requestId, 'ignored');
            provider.complete(answer.requestId);
            await flushCallbacks();
        }
        const snapshot = await coordinator.getSnapshot(10, 1);

        expect(snapshot.questions).toHaveLength(2);
        expect(snapshot.answers).toHaveLength(2);
        expect(snapshot.answers.every(({ text }) => text === 'abcdef')).toBe(true);
    });

    it('should preserve monotonic outbound sequence numbers and never persist partials', async () => {
        const { accessor, transports, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentId = createRealtimeId();
        await coordinator.ingestTranscriptEvent(10, 1, createRealtimeEvent({
            type: RealtimeEventType.TRANSCRIPT_PARTIAL,
            sessionId: '1',
            sequenceNumber: 1,
            payload: { segmentId, speaker: Speaker.INTERVIEWER, text: 'partial' },
        }));
        const snapshot = await coordinator.getSnapshot(10, 1);
        const events = transports.getTransport('1')?.events ?? [];

        expect(snapshot.transcripts).toEqual([
            expect.objectContaining({ segmentId, isFinal: false }),
        ]);
        expect(events.map(({ sequenceNumber }) => sequenceNumber)).toEqual(
            events.map((_event, index) => index + 1),
        );
        expect(accessor.sessions.get(1)).not.toHaveProperty('transcripts');
    });

    it('should forward released transcripts in semantic order with fresh metadata and no duplicates', async () => {
        const { accessor, transports, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentIds = [createRealtimeId(), createRealtimeId(), createRealtimeId()];
        const sourceEvents = [
            createRealtimeEvent({
                type: RealtimeEventType.TRANSCRIPT_PARTIAL,
                sessionId: '1',
                sequenceNumber: 1,
                payload: { segmentId: segmentIds[0] ?? '', speaker: Speaker.INTERVIEWER, text: 'one' },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.TRANSCRIPT_FINAL,
                sessionId: '1',
                sequenceNumber: 3,
                payload: { segmentId: segmentIds[2] ?? '', speaker: Speaker.INTERVIEWER, text: 'three' },
            }),
            createRealtimeEvent({
                type: RealtimeEventType.TRANSCRIPT_PARTIAL,
                sessionId: '1',
                sequenceNumber: 2,
                payload: { segmentId: segmentIds[1] ?? '', speaker: Speaker.INTERVIEWER, text: 'two' },
            }),
        ];

        await coordinator.ingestTranscriptEvent(10, 1, sourceEvents[0]);
        await coordinator.ingestTranscriptEvent(10, 1, sourceEvents[1]);
        await coordinator.ingestTranscriptEvent(10, 1, sourceEvents[1]);
        await coordinator.ingestTranscriptEvent(10, 1, sourceEvents[2]);
        const transcriptEvents = (transports.getTransport('1')?.events ?? []).filter(isTranscriptEvent);

        expect(transcriptEvents.map(({ payload }) => payload.text)).toEqual(['one', 'two', 'three']);
        expect(transcriptEvents.map(({ sequenceNumber }) => sequenceNumber)).toEqual([4, 5, 6]);
        const sourceEventIds = sourceEvents.map(({ eventId }) => eventId);
        expect(transcriptEvents.every(({ eventId }) => !sourceEventIds.includes(eventId))).toBe(true);
    });

    it('should emit only exact lowercase lifecycle names without interview content', async () => {
        const { accessor, provider, lifecycleLogger, coordinator } = createHarness();
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentId = await ingestFinal(coordinator, 10, 1, 1, 'PRIVATE_QUESTION_TEXT');
        const question = await coordinator.detectQuestion(10, 1, segmentId);
        const answer = await coordinator.requestAnswer(10, 1, question.questionId);
        provider.emitChunk(answer.requestId, 'PRIVATE_ANSWER_TEXT');
        provider.complete(answer.requestId);
        await flushCallbacks();
        await coordinator.pause(10, 1);
        await coordinator.resume(10, 1);
        await coordinator.stop(10, 1);

        expect(Object.values(InterviewLifecycleLogName)).toEqual([
            'session_created', 'session_started', 'session_paused', 'session_resumed',
            'session_completed', 'session_failed', 'transcript_partial_received',
            'transcript_final_received', 'question_detected', 'question_cancelled',
            'answer_started', 'answer_completed', 'answer_failed', 'answer_cancelled',
        ]);
        expect(JSON.stringify(lifecycleLogger.metrics)).not.toContain('PRIVATE_');
        expect(lifecycleLogger.metrics.map(({ name }) => name)).toEqual(expect.arrayContaining([
            'session_created', 'session_started', 'transcript_final_received', 'question_detected',
            'answer_started', 'answer_completed', 'session_paused', 'session_resumed',
            'session_completed',
        ]));
    });

    it('should abort and fail an answer once when its bounded timeout expires', async () => {
        const { accessor, provider, transports, lifecycleLogger, coordinator } = createHarness({
            answerTimeoutMs: 10,
        });
        await addSession(accessor, 1, 10);
        await initializeRecording(coordinator, 10, 1);
        const segmentId = await ingestFinal(coordinator, 10, 1, 1);
        const question = await coordinator.detectQuestion(10, 1, segmentId);
        const answer = await coordinator.requestAnswer(10, 1, question.questionId);

        await flushCallbacks(25);
        const snapshot = await coordinator.getSnapshot(10, 1);
        const timeoutEvents = (transports.getTransport('1')?.events ?? []).filter(
            ({ type }) => type === RealtimeEventType.ANSWER_FAILED,
        );
        expect(provider.wasCancelled(answer.requestId)).toBe(true);
        expect(snapshot.questions[0]?.status).toBe('FAILED');
        expect(snapshot.answers[0]?.status).toBe('FAILED');
        expect(timeoutEvents).toHaveLength(1);
        expect(timeoutEvents[0]?.payload).toMatchObject({ code: 'ANSWER_TIMEOUT' });
        expect(lifecycleLogger.metrics).toContainEqual(expect.objectContaining({
            name: 'answer_failed',
            metadata: expect.objectContaining({ code: 'ANSWER_TIMEOUT' }),
        }));
        await coordinator.stop(10, 1);
        await flushCallbacks(20);
        expect((transports.getTransport('1')?.events ?? []).filter(
            ({ type }) => type === RealtimeEventType.ANSWER_FAILED,
        )).toHaveLength(1);
    });
});
