import { describe, expect, it } from '@jest/globals';

import {
    AnswerStatus,
    InterviewAnswer,
    InterviewQuestion,
    InterviewSession,
    InterviewSessionStatus,
    LifecycleTransitionErrorCode,
    QuestionStatus,
} from '../../shared/interview/InterviewSession';

function createSessionAt(status: InterviewSessionStatus): InterviewSession {
    const session = new InterviewSession('session');
    const paths: Readonly<Record<InterviewSessionStatus, ReadonlyArray<InterviewSessionStatus>>> = {
        [InterviewSessionStatus.CREATED]: [],
        [InterviewSessionStatus.INITIALIZING]: [InterviewSessionStatus.INITIALIZING],
        [InterviewSessionStatus.READY]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
        ],
        [InterviewSessionStatus.RECORDING]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.RECORDING,
        ],
        [InterviewSessionStatus.PROCESSING]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.RECORDING,
            InterviewSessionStatus.PROCESSING,
        ],
        [InterviewSessionStatus.PAUSED]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.RECORDING,
            InterviewSessionStatus.PAUSED,
        ],
        [InterviewSessionStatus.STOPPING]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.STOPPING,
        ],
        [InterviewSessionStatus.COMPLETED]: [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.STOPPING,
            InterviewSessionStatus.COMPLETED,
        ],
        [InterviewSessionStatus.FAILED]: [InterviewSessionStatus.FAILED],
    };
    for (const nextStatus of paths[status]) {
        session.transitionTo(nextStatus);
    }
    return session;
}

describe('InterviewSession', () => {
    it('should support recording, processing, pause, resume, stop, and completion', () => {
        const session = new InterviewSession('session');
        const lifecycle = [
            InterviewSessionStatus.INITIALIZING,
            InterviewSessionStatus.READY,
            InterviewSessionStatus.RECORDING,
            InterviewSessionStatus.PROCESSING,
            InterviewSessionStatus.RECORDING,
            InterviewSessionStatus.PAUSED,
            InterviewSessionStatus.RECORDING,
            InterviewSessionStatus.STOPPING,
            InterviewSessionStatus.COMPLETED,
        ];

        for (const status of lifecycle) {
            expect(session.transitionTo(status)).toBe(status);
        }
        expect(session.status).toBe(InterviewSessionStatus.COMPLETED);
    });

    it.each([
        InterviewSessionStatus.CREATED,
        InterviewSessionStatus.INITIALIZING,
        InterviewSessionStatus.READY,
        InterviewSessionStatus.RECORDING,
        InterviewSessionStatus.PROCESSING,
        InterviewSessionStatus.PAUSED,
        InterviewSessionStatus.STOPPING,
    ])('should permit failure from non-terminal status %s', (status) => {
        const session = createSessionAt(status);
        expect(session.transitionTo(InterviewSessionStatus.FAILED)).toBe(
            InterviewSessionStatus.FAILED,
        );
    });

    it('should reject an invalid transition without mutating status', () => {
        const session = new InterviewSession('session');

        expect(() => session.transitionTo(InterviewSessionStatus.READY)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.INVALID_TRANSITION }),
        );
        expect(session.status).toBe(InterviewSessionStatus.CREATED);
    });

    it.each([InterviewSessionStatus.COMPLETED, InterviewSessionStatus.FAILED])(
        'should reject transitions from terminal status %s',
        (status) => {
            const session = createSessionAt(status);
            expect(() => session.transitionTo(InterviewSessionStatus.RECORDING)).toThrow(
                expect.objectContaining({ code: LifecycleTransitionErrorCode.TERMINAL_STATE }),
            );
        },
    );

    it('should hydrate a persisted session status without replaying transitions', () => {
        const session = new InterviewSession('1', InterviewSessionStatus.PROCESSING);

        expect(session.status).toBe(InterviewSessionStatus.PROCESSING);
        expect(session.transitionTo(InterviewSessionStatus.RECORDING)).toBe(
            InterviewSessionStatus.RECORDING,
        );
    });
});

describe('question and answer lifecycles', () => {
    it('should expose exactly the required question and answer statuses', () => {
        expect(Object.values(QuestionStatus)).toEqual([
            'DETECTED',
            'PROCESSING',
            'ANSWERING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
        ]);
        expect(Object.values(AnswerStatus)).toEqual([
            'PENDING',
            'STREAMING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
        ]);
    });

    it('should guard the complete question lifecycle', () => {
        const question = new InterviewQuestion('question');

        expect(question.status).toBe(QuestionStatus.DETECTED);
        expect(question.transitionTo(QuestionStatus.PROCESSING)).toBe(QuestionStatus.PROCESSING);
        expect(question.transitionTo(QuestionStatus.ANSWERING)).toBe(QuestionStatus.ANSWERING);
        expect(question.transitionTo(QuestionStatus.COMPLETED)).toBe(QuestionStatus.COMPLETED);
        expect(() => question.transitionTo(QuestionStatus.FAILED)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.TERMINAL_STATE }),
        );
    });

    it.each([
        QuestionStatus.DETECTED,
        QuestionStatus.PROCESSING,
        QuestionStatus.ANSWERING,
    ])('should permit question failure and cancellation from active status %s', (status) => {
        const failedQuestion = new InterviewQuestion('failed', status);
        const cancelledQuestion = new InterviewQuestion('cancelled', status);

        expect(failedQuestion.transitionTo(QuestionStatus.FAILED)).toBe(QuestionStatus.FAILED);
        expect(cancelledQuestion.transitionTo(QuestionStatus.CANCELLED)).toBe(
            QuestionStatus.CANCELLED,
        );
    });

    it('should reject invalid question transitions and hydrate current status', () => {
        const invalidQuestion = new InterviewQuestion('invalid');
        expect(() => invalidQuestion.transitionTo(QuestionStatus.COMPLETED)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.INVALID_TRANSITION }),
        );

        const hydratedQuestion = new InterviewQuestion('hydrated', QuestionStatus.PROCESSING);
        expect(hydratedQuestion.status).toBe(QuestionStatus.PROCESSING);
    });

    it.each([
        QuestionStatus.COMPLETED,
        QuestionStatus.FAILED,
        QuestionStatus.CANCELLED,
    ])('should reject transitions from terminal question status %s', (status) => {
        const question = new InterviewQuestion('terminal', status);
        expect(() => question.transitionTo(QuestionStatus.PROCESSING)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.TERMINAL_STATE }),
        );
    });

    it('should guard the pending, streaming, and completed answer lifecycle', () => {
        const answer = new InterviewAnswer('answer', 'question', 'request');

        expect(answer.status).toBe(AnswerStatus.PENDING);
        expect(answer.transitionTo(AnswerStatus.STREAMING)).toBe(AnswerStatus.STREAMING);
        expect(answer.transitionTo(AnswerStatus.COMPLETED)).toBe(AnswerStatus.COMPLETED);
        expect(() => answer.transitionTo(AnswerStatus.FAILED)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.TERMINAL_STATE }),
        );
    });

    it.each([AnswerStatus.PENDING, AnswerStatus.STREAMING])(
        'should permit answer failure and cancellation from active status %s',
        (status) => {
            const failedAnswer = new InterviewAnswer('failed', 'question', 'request', status);
            const cancelledAnswer = new InterviewAnswer('cancelled', 'question', 'request', status);

            expect(failedAnswer.transitionTo(AnswerStatus.FAILED)).toBe(AnswerStatus.FAILED);
            expect(cancelledAnswer.transitionTo(AnswerStatus.CANCELLED)).toBe(
                AnswerStatus.CANCELLED,
            );
        },
    );

    it('should reject invalid answer transitions and hydrate current status', () => {
        const invalidAnswer = new InterviewAnswer('invalid', 'question', 'request');
        expect(() => invalidAnswer.transitionTo(AnswerStatus.COMPLETED)).toThrow(
            expect.objectContaining({ code: LifecycleTransitionErrorCode.INVALID_TRANSITION }),
        );

        const hydratedAnswer = new InterviewAnswer(
            'hydrated',
            'question',
            'request',
            AnswerStatus.STREAMING,
        );
        expect(hydratedAnswer.status).toBe(AnswerStatus.STREAMING);
    });

    it.each([AnswerStatus.COMPLETED, AnswerStatus.FAILED, AnswerStatus.CANCELLED])(
        'should reject transitions from terminal answer status %s',
        (status) => {
            const answer = new InterviewAnswer('terminal', 'question', 'request', status);
            expect(() => answer.transitionTo(AnswerStatus.STREAMING)).toThrow(
                expect.objectContaining({ code: LifecycleTransitionErrorCode.TERMINAL_STATE }),
            );
        },
    );
});