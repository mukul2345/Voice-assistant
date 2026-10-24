import { AnswerStatus, QuestionStatus } from '../../shared/interview/InterviewSession';
import { RealtimeEventType } from '../../shared/interview/RealtimeProtocol';
import {
    AnswerGenerationFailure,
    AnswerGenerationIdentity,
    BoundedAnswerChunkObserver,
} from './InterviewProviders';
import {
    InterviewLifecycleLogger,
    InterviewLifecycleLogName,
    isSafeInterviewCode,
} from './InterviewCoordinatorContracts';
import { InterviewEventPublisher } from './InterviewEventPublisher';
import {
    InterviewAnswerRecord,
    InterviewQuestionRecord,
    InterviewSessionRuntime,
} from './InterviewSessionRuntime';

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/** Applies exactly associated provider callbacks and owns active-answer timeout timers. */
export class InterviewAnswerCallbacks {
    public constructor(
        private readonly lifecycleLogger: InterviewLifecycleLogger,
        private readonly answerTimeoutMs: number,
        private readonly maxAnswerBytes: number,
        private readonly maxChunkBytes: number,
    ) {}

    public createObserver(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
    ): BoundedAnswerChunkObserver {
        return {
            maxChunkBytes: this.maxChunkBytes,
            maxAnswerBytes: this.maxAnswerBytes,
            onChunk: (chunk) => void this.runCallback(this.applyChunk(runtime, publisher, chunk)),
            onComplete: (identity) => void this.runCallback(
                this.completeAnswer(sessionId, runtime, publisher, identity),
            ),
            onFailure: (failure) => void this.runCallback(
                this.failAnswer(sessionId, runtime, publisher, failure),
            ),
        };
    }

    public startTimeout(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        answer: InterviewAnswerRecord,
    ): void {
        const identity = this.identity(answer);
        answer.timeout = setTimeout(() => {
            void this.runCallback(this.transitionAnswerToFailed(
                sessionId,
                runtime,
                publisher,
                identity,
                'ANSWER_TIMEOUT',
            ));
        }, this.answerTimeoutMs);
    }
    public clearTimer(answer: InterviewAnswerRecord): void {
        if (answer.timeout !== undefined) {
            clearTimeout(answer.timeout);
            answer.timeout = undefined;
        }
    }

    private async runCallback(callback: Promise<void>): Promise<void> {
        try {
            await callback;
        } catch {
            // Provider callbacks cannot safely expose transport failures to provider code.
        }
    }

    private async applyChunk(
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        chunk: AnswerGenerationIdentity & { readonly text: string },
    ): Promise<void> {
        const answer = runtime.getActiveAnswer(chunk);
        if (answer === undefined || utf8ByteLength(chunk.text) > this.maxChunkBytes) {
            return;
        }
        const combinedText = answer.text + chunk.text;
        if (chunk.text.length === 0 || utf8ByteLength(combinedText) > this.maxAnswerBytes) {
            return;
        }
        answer.text = combinedText;
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.ANSWER_CHUNK,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: { ...this.eventIdentity(answer), text: chunk.text },
        }));
    }

    private async completeAnswer(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        identity: AnswerGenerationIdentity,
    ): Promise<void> {
        const answer = runtime.getActiveAnswer(identity);
        if (answer === undefined) {
            return;
        }
        const question = runtime.getQuestion(answer.machine.questionId);
        if (question === undefined) {
            return;
        }
        this.clearTimer(answer);
        answer.machine.transitionTo(AnswerStatus.COMPLETED);
        question.machine.transitionTo(QuestionStatus.COMPLETED);
        runtime.clearActiveRequest(answer.machine.requestId);
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.ANSWER_COMPLETED,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: this.eventIdentity(answer),
        }));
        await this.publishQuestionState(publisher, runtime, question);
        this.lifecycleLogger.info(InterviewLifecycleLogName.ANSWER_COMPLETED, {
            sessionId,
            ...this.eventIdentity(answer),
            status: AnswerStatus.COMPLETED,
        });
    }
    private async failAnswer(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        failure: AnswerGenerationFailure,
    ): Promise<void> {
        const code = isSafeInterviewCode(failure.code) ? failure.code : 'ANSWER_PROVIDER_FAILED';
        await this.transitionAnswerToFailed(sessionId, runtime, publisher, failure, code);
    }

    private async transitionAnswerToFailed(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        identity: AnswerGenerationIdentity,
        code: string,
    ): Promise<void> {
        const answer = runtime.getActiveAnswer(identity);
        if (answer === undefined) {
            return;
        }
        const question = runtime.getQuestion(answer.machine.questionId);
        if (question === undefined) {
            return;
        }
        this.clearTimer(answer);
        answer.abortController.abort();
        answer.machine.transitionTo(AnswerStatus.FAILED);
        question.machine.transitionTo(QuestionStatus.FAILED);
        runtime.clearActiveRequest(answer.machine.requestId);
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.ANSWER_FAILED,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: { ...this.eventIdentity(answer), code },
        }));
        await this.publishQuestionState(publisher, runtime, question);
        this.lifecycleLogger.info(InterviewLifecycleLogName.ANSWER_FAILED, {
            sessionId,
            ...this.eventIdentity(answer),
            status: AnswerStatus.FAILED,
            code,
        });
    }

    private async publishQuestionState(
        publisher: InterviewEventPublisher,
        runtime: InterviewSessionRuntime,
        question: InterviewQuestionRecord,
    ): Promise<void> {
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.QUESTION_STATE_CHANGED,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: {
                questionId: question.machine.questionId,
                status: question.machine.status,
            },
        }));
    }

    private identity(answer: InterviewAnswerRecord): AnswerGenerationIdentity {
        return { sessionId: answer.sessionId, ...this.eventIdentity(answer) };
    }

    private eventIdentity(answer: InterviewAnswerRecord): Omit<AnswerGenerationIdentity, 'sessionId'> {
        return {
            questionId: answer.machine.questionId,
            answerId: answer.machine.answerId,
            requestId: answer.machine.requestId,
        };
    }
}
