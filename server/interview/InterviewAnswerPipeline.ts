import { AnswerStatus, QuestionStatus } from '../../shared/interview/InterviewSession';
import { createRealtimeId, RealtimeEventType } from '../../shared/interview/RealtimeProtocol';
import {
    AnswerGenerationIdentity,
    AnswerGenerationRequest,
    InterviewAnswerProvider,
} from './InterviewProviders';
import { InterviewAnswerCallbacks } from './InterviewAnswerCallbacks';
import {
    InterviewAnswerSnapshot,
    InterviewLifecycleLogger,
    InterviewLifecycleLogName,
} from './InterviewCoordinatorContracts';
import { InterviewEventPublisher } from './InterviewEventPublisher';
import {
    InterviewAnswerRecord,
    InterviewQuestionRecord,
    InterviewSessionRuntime,
} from './InterviewSessionRuntime';

/** Owns answer request creation, supersession, and provider invocation. */
export class InterviewAnswerPipeline {
    private readonly callbacks: InterviewAnswerCallbacks;

    public constructor(
        private readonly answerProvider: InterviewAnswerProvider,
        private readonly lifecycleLogger: InterviewLifecycleLogger,
        answerTimeoutMs: number,
        maxAnswerBytes: number,
        maxChunkBytes: number,
    ) {
        this.callbacks = new InterviewAnswerCallbacks(
            lifecycleLogger,
            answerTimeoutMs,
            maxAnswerBytes,
            maxChunkBytes,
        );
    }

    public async requestAnswer(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        question: InterviewQuestionRecord,
    ): Promise<InterviewAnswerSnapshot> {
        await this.cancelActiveAnswer(sessionId, runtime, publisher, 'SUPERSEDED');
        question.machine.transitionTo(QuestionStatus.PROCESSING);
        await this.publishQuestionState(publisher, runtime, question);
        const answer = runtime.addAnswer(createRealtimeId(), question.machine.questionId, createRealtimeId());
        answer.machine.transitionTo(AnswerStatus.STREAMING);
        question.machine.transitionTo(QuestionStatus.ANSWERING);
        await this.publishQuestionState(publisher, runtime, question);
        await this.publishAnswerStarted(sessionId, publisher, runtime, answer);
        this.callbacks.startTimeout(sessionId, runtime, publisher, answer);
        const request = this.createRequest(sessionId, runtime, publisher, question, answer);
        void this.invokeAnswerProvider(request);
        return this.snapshot(answer);
    }

    public async cancelActiveAnswer(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        code: string,
    ): Promise<void> {
        const answer = runtime.getActiveAnswerRecord();
        if (answer === undefined) {
            return;
        }
        runtime.clearActiveRequest(answer.machine.requestId);
        this.callbacks.clearTimer(answer);
        answer.abortController.abort();
        if (answer.machine.status !== AnswerStatus.PENDING
            && answer.machine.status !== AnswerStatus.STREAMING) {
            return;
        }
        answer.machine.transitionTo(AnswerStatus.CANCELLED);
        const question = runtime.getQuestion(answer.machine.questionId);
        const questionWasCancelled = this.cancelQuestion(question);
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.ANSWER_CANCELLED,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: { ...this.eventIdentity(answer), code },
        }));
        if (question !== undefined) {
            await this.publishQuestionState(publisher, runtime, question);
        }
        this.recordCancellationMetrics(sessionId, answer, questionWasCancelled, code);
    }
    private createRequest(
        sessionId: number,
        runtime: InterviewSessionRuntime,
        publisher: InterviewEventPublisher,
        question: InterviewQuestionRecord,
        answer: InterviewAnswerRecord,
    ): AnswerGenerationRequest {
        return {
            ...this.identity(answer),
            questionText: question.text,
            signal: answer.abortController.signal,
            observer: this.callbacks.createObserver(sessionId, runtime, publisher),
        };
    }

    private async invokeAnswerProvider(request: AnswerGenerationRequest): Promise<void> {
        try {
            await this.answerProvider.generate(request);
        } catch {
            request.observer.onFailure({
                sessionId: request.sessionId,
                questionId: request.questionId,
                answerId: request.answerId,
                requestId: request.requestId,
                code: 'ANSWER_PROVIDER_FAILED',
            });
        }
    }

    private cancelQuestion(question: InterviewQuestionRecord | undefined): boolean {
        if (question === undefined
            || question.machine.status === QuestionStatus.COMPLETED
            || question.machine.status === QuestionStatus.FAILED
            || question.machine.status === QuestionStatus.CANCELLED) {
            return false;
        }
        question.machine.transitionTo(QuestionStatus.CANCELLED);
        return true;
    }

    private recordCancellationMetrics(
        sessionId: number,
        answer: InterviewAnswerRecord,
        questionWasCancelled: boolean,
        code: string,
    ): void {
        if (questionWasCancelled) {
            this.lifecycleLogger.info(InterviewLifecycleLogName.QUESTION_CANCELLED, {
                sessionId,
                questionId: answer.machine.questionId,
                status: QuestionStatus.CANCELLED,
            });
        }
        this.lifecycleLogger.info(InterviewLifecycleLogName.ANSWER_CANCELLED, {
            sessionId,
            ...this.eventIdentity(answer),
            status: AnswerStatus.CANCELLED,
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

    private async publishAnswerStarted(
        sessionId: number,
        publisher: InterviewEventPublisher,
        runtime: InterviewSessionRuntime,
        answer: InterviewAnswerRecord,
    ): Promise<void> {
        await publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.ANSWER_STARTED,
            sessionId: runtime.machine.sessionId,
            sequenceNumber,
            payload: this.eventIdentity(answer),
        }));
        this.lifecycleLogger.info(InterviewLifecycleLogName.ANSWER_STARTED, {
            sessionId,
            ...this.eventIdentity(answer),
            status: AnswerStatus.STREAMING,
        });
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

    private snapshot(answer: InterviewAnswerRecord): InterviewAnswerSnapshot {
        return {
            ...this.eventIdentity(answer),
            status: answer.machine.status,
            text: answer.text,
        };
    }
}
