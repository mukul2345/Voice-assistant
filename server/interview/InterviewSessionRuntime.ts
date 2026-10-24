import {
    AnswerStatus,
    InterviewAnswer,
    InterviewQuestion,
    InterviewSession,
    InterviewSessionStatus,
    QuestionStatus,
} from '../../shared/interview/InterviewSession';
import { RealtimeEvent } from '../../shared/interview/RealtimeProtocol';
import {
    TranscriptReconciler,
    TranscriptReconciliationResult,
    TranscriptSegmentSnapshot,
} from '../../shared/interview/TranscriptReconciler';
import { AnswerGenerationIdentity } from './InterviewProviders';
import {
    InterviewAnswerSnapshot,
    InterviewCoordinatorError,
    InterviewCoordinatorErrorCode,
    InterviewCoordinatorSnapshot,
    InterviewQuestionSnapshot,
    OwnedInterviewSession,
} from './InterviewCoordinatorContracts';

export interface InterviewQuestionRecord {
    readonly machine: InterviewQuestion;
    readonly segmentId: string;
    readonly text: string;
}

export interface InterviewAnswerRecord {
    readonly machine: InterviewAnswer;
    readonly sessionId: string;
    readonly abortController: AbortController;
    text: string;
    timeout?: ReturnType<typeof setTimeout>;
}

interface InterviewSessionRuntimeOptions {
    readonly maxQuestions: number;
    readonly maxAnswers: number;
    readonly maxTranscriptSegments: number;
}

/** Owns bounded in-memory domain state for exactly one interview session. */
export class InterviewSessionRuntime {
    public machine: InterviewSession;
    public readonly reconciler: TranscriptReconciler;
    private readonly questions = new Map<string, InterviewQuestionRecord>();
    private readonly answers = new Map<string, InterviewAnswerRecord>();
    private readonly questionOrder: string[] = [];
    private readonly answerOrder: string[] = [];
    private activeRequestId?: string;
    private acceptingEvents = true;
    public constructor(
        ownedSession: OwnedInterviewSession,
        private readonly options: InterviewSessionRuntimeOptions,
    ) {
        this.machine = new InterviewSession(String(ownedSession.id), ownedSession.status);
        this.reconciler = new TranscriptReconciler({
            sessionId: String(ownedSession.id),
            maxRetainedSegments: options.maxTranscriptSegments,
        });
    }

    public synchronize(status: InterviewSessionStatus): void {
        this.machine = new InterviewSession(this.machine.sessionId, status);
        if (status === InterviewSessionStatus.COMPLETED || status === InterviewSessionStatus.FAILED) {
            this.acceptingEvents = false;
        }
    }

    public stopAcceptingEvents(): void {
        this.acceptingEvents = false;
    }

    public requireAcceptingEvents(): void {
        if (!this.acceptingEvents) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.SESSION_TERMINAL);
        }
    }

    public reconcile(event: RealtimeEvent): TranscriptReconciliationResult {
        return this.reconciler.reconcile(event);
    }

    public findFinalSegment(segmentId: string): TranscriptSegmentSnapshot | undefined {
        return this.reconciler.getPersistableFinalSnapshots()
            .find((candidate) => candidate.segmentId === segmentId);
    }

    public addQuestion(questionId: string, segment: TranscriptSegmentSnapshot): InterviewQuestionRecord {
        this.ensureQuestionCapacity();
        const question: InterviewQuestionRecord = {
            machine: new InterviewQuestion(questionId),
            segmentId: segment.segmentId,
            text: segment.text,
        };
        this.questions.set(questionId, question);
        this.questionOrder.push(questionId);
        return question;
    }

    public getQuestion(questionId: string): InterviewQuestionRecord | undefined {
        return this.questions.get(questionId);
    }

    public addAnswer(answerId: string, questionId: string, requestId: string): InterviewAnswerRecord {
        this.ensureAnswerCapacity();
        const answer: InterviewAnswerRecord = {
            machine: new InterviewAnswer(answerId, questionId, requestId),
            sessionId: this.machine.sessionId,
            abortController: new AbortController(),
            text: '',
        };
        this.answers.set(answerId, answer);
        this.answerOrder.push(answerId);
        this.activeRequestId = requestId;
        return answer;
    }
    public getActiveAnswer(identity: AnswerGenerationIdentity): InterviewAnswerRecord | undefined {
        if (this.activeRequestId !== identity.requestId || !this.acceptingEvents) {
            return undefined;
        }
        const answer = this.answers.get(identity.answerId);
        if (answer === undefined) {
            return undefined;
        }
        if (
            identity.sessionId !== this.machine.sessionId
            || identity.questionId !== answer.machine.questionId
            || identity.requestId !== answer.machine.requestId
        ) {
            return undefined;
        }
        return answer.machine.status === AnswerStatus.STREAMING ? answer : undefined;
    }

    public getActiveAnswerRecord(): InterviewAnswerRecord | undefined {
        const requestId = this.activeRequestId;
        if (requestId === undefined) {
            return undefined;
        }
        return Array.from(this.answers.values())
            .find((candidate) => candidate.machine.requestId === requestId);
    }

    public clearActiveRequest(requestId: string): void {
        if (this.activeRequestId === requestId) {
            this.activeRequestId = undefined;
        }
    }

    public createSnapshot(
        sessionId: number,
        status: InterviewSessionStatus,
        failureCode: string | null,
    ): InterviewCoordinatorSnapshot {
        return {
            sessionId,
            status,
            failureCode,
            transcripts: this.reconciler.getCurrentSegments(),
            questions: this.questionOrder.flatMap((questionId) => {
                const question = this.questions.get(questionId);
                return question === undefined ? [] : [this.questionSnapshot(question)];
            }),
            answers: this.answerOrder.flatMap((answerId) => {
                const answer = this.answers.get(answerId);
                return answer === undefined ? [] : [this.answerSnapshot(answer)];
            }),
        };
    }

    public clearAllAnswerTimers(): void {
        Array.from(this.answers.values()).forEach((answer) => {
            if (answer.timeout !== undefined) {
                clearTimeout(answer.timeout);
                answer.timeout = undefined;
            }
        });
    }

    private ensureQuestionCapacity(): void {
        while (this.questions.size >= this.options.maxQuestions) {
            const questionId = this.questionOrder[0];
            if (questionId === undefined) {
                return;
            }
            const question = this.questions.get(questionId);
            if (question !== undefined && !this.isTerminalQuestion(question)) {
                throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.CAPACITY_EXCEEDED);
            }
            this.questionOrder.shift();
            this.questions.delete(questionId);
        }
    }
    private ensureAnswerCapacity(): void {
        while (this.answers.size >= this.options.maxAnswers) {
            const answerId = this.answerOrder[0];
            if (answerId === undefined) {
                return;
            }
            const answer = this.answers.get(answerId);
            if (answer !== undefined && !this.isTerminalAnswer(answer)) {
                throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.CAPACITY_EXCEEDED);
            }
            this.answerOrder.shift();
            this.answers.delete(answerId);
        }
    }

    private isTerminalQuestion(question: InterviewQuestionRecord): boolean {
        return question.machine.status === QuestionStatus.COMPLETED
            || question.machine.status === QuestionStatus.FAILED
            || question.machine.status === QuestionStatus.CANCELLED;
    }

    private isTerminalAnswer(answer: InterviewAnswerRecord): boolean {
        return answer.machine.status === AnswerStatus.COMPLETED
            || answer.machine.status === AnswerStatus.FAILED
            || answer.machine.status === AnswerStatus.CANCELLED;
    }

    private questionSnapshot(question: InterviewQuestionRecord): InterviewQuestionSnapshot {
        return {
            questionId: question.machine.questionId,
            segmentId: question.segmentId,
            status: question.machine.status,
        };
    }

    private answerSnapshot(answer: InterviewAnswerRecord): InterviewAnswerSnapshot {
        return {
            answerId: answer.machine.answerId,
            questionId: answer.machine.questionId,
            requestId: answer.machine.requestId,
            status: answer.machine.status,
            text: answer.text,
        };
    }
}
