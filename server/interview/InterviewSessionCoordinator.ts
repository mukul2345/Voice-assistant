import { InterviewSessionStatus } from '../../shared/interview/InterviewSession';
import { RealtimeEventType } from '../../shared/interview/RealtimeProtocol';
import { TranscriptSegmentSnapshot } from '../../shared/interview/TranscriptReconciler';
import { InterviewAnswerProvider } from './InterviewProviders';
import { InterviewAnswerPipeline } from './InterviewAnswerPipeline';
import {
    defaultInterviewLifecycleLogger,
    InterviewCoordinatorError,
    InterviewCoordinatorErrorCode,
    InterviewCoordinatorSnapshot,
    InterviewLifecycleLogger,
    InterviewLifecycleLogName,
    InterviewQuestionSnapshot,
    InterviewAnswerSnapshot,
    InterviewSessionCoordinatorOptions,
    InterviewSessionOwnershipAccessor,
    isSafeInterviewCode,
} from './InterviewCoordinatorContracts';
import { createInterviewCoordinatorConfiguration } from './InterviewCoordinatorConfiguration';
import { InterviewRealtimeTransportFactory } from './InterviewRealtimeTransport';
import { InterviewSessionContext, InterviewSessionRegistry } from './InterviewSessionRegistry';
import { InterviewTranscriptPipeline } from './InterviewTranscriptPipeline';

export * from './InterviewCoordinatorContracts';

/** Provider-independent owner-scoped orchestration for realtime interview sessions. */
export class InterviewSessionCoordinator {
    private readonly lifecycleLogger: InterviewLifecycleLogger;
    private readonly answerPipeline: InterviewAnswerPipeline;
    private readonly transcriptPipeline: InterviewTranscriptPipeline;
    private readonly registry: InterviewSessionRegistry;
    private readonly connectTimeoutMs: number;
    public constructor(
        ownershipAccessor: InterviewSessionOwnershipAccessor,
        answerProvider: InterviewAnswerProvider,
        transportFactory: InterviewRealtimeTransportFactory,
        options: InterviewSessionCoordinatorOptions = {},
    ) {
        const configuration = createInterviewCoordinatorConfiguration(options);
        this.connectTimeoutMs = configuration.connectTimeoutMs;
        this.lifecycleLogger = options.logger ?? defaultInterviewLifecycleLogger;
        this.answerPipeline = new InterviewAnswerPipeline(
            answerProvider,
            this.lifecycleLogger,
            configuration.answerTimeoutMs,
            configuration.maxAnswerBytes,
            configuration.maxChunkBytes,
        );
        this.transcriptPipeline = new InterviewTranscriptPipeline(
            this.answerPipeline,
            this.lifecycleLogger,
        );
        this.registry = new InterviewSessionRegistry(ownershipAccessor, transportFactory, {
            closeTimeoutMs: configuration.closeTimeoutMs,
            maxSessions: configuration.maxSessions,
            maxQuestions: configuration.maxQuestions,
            maxAnswers: configuration.maxAnswers,
            maxTranscriptSegments: configuration.maxTranscriptSegments,
            maxOutboundEvents: configuration.maxOutboundEvents,
        });
    }

    /** Initializes an owned CREATED session and connects its bounded transport. */
    public async initialize(authenticatedUserId: number, sessionId: number): Promise<void> {
        const { context, ownedSession } = await this.registry.openContext(authenticatedUserId, sessionId);
        this.recordMetric(InterviewLifecycleLogName.SESSION_CREATED, sessionId, {
            status: ownedSession.status,
        });
        await this.registry.transitionSession(
            authenticatedUserId,
            sessionId,
            context,
            InterviewSessionStatus.INITIALIZING,
        );
        try {
            await context.publisher.connect(this.connectTimeoutMs);
            await this.publishCurrentSessionState(context);
            await this.registry.transitionSession(
                authenticatedUserId,
                sessionId,
                context,
                InterviewSessionStatus.READY,
            );
        } catch (cause: unknown) {
            const code = cause instanceof InterviewCoordinatorError
                && cause.code === InterviewCoordinatorErrorCode.TRANSPORT_TIMEOUT
                ? 'TRANSPORT_CONNECT_TIMEOUT'
                : 'INITIALIZATION_FAILED';
            await this.failRuntime(authenticatedUserId, sessionId, context, code);
            throw cause;
        }
    }
    /** Starts recording for an owned READY session. */
    public async start(authenticatedUserId: number, sessionId: number): Promise<void> {
        await this.transitionWithMetric(
            authenticatedUserId,
            sessionId,
            InterviewSessionStatus.RECORDING,
            InterviewLifecycleLogName.SESSION_STARTED,
        );
    }

    /** Marks an owned recording session as processing. */
    public async markProcessing(authenticatedUserId: number, sessionId: number): Promise<void> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        await this.registry.transitionSession(
            authenticatedUserId,
            sessionId,
            context,
            InterviewSessionStatus.PROCESSING,
        );
    }

    /** Continues recording after processing. */
    public async continueRecording(authenticatedUserId: number, sessionId: number): Promise<void> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        await this.registry.transitionSession(
            authenticatedUserId,
            sessionId,
            context,
            InterviewSessionStatus.RECORDING,
        );
    }

    /** Pauses an owned recording or processing session. */
    public async pause(authenticatedUserId: number, sessionId: number): Promise<void> {
        await this.transitionWithMetric(
            authenticatedUserId,
            sessionId,
            InterviewSessionStatus.PAUSED,
            InterviewLifecycleLogName.SESSION_PAUSED,
        );
    }

    /** Resumes an owned paused session. */
    public async resume(authenticatedUserId: number, sessionId: number): Promise<void> {
        await this.transitionWithMetric(
            authenticatedUserId,
            sessionId,
            InterviewSessionStatus.RECORDING,
            InterviewLifecycleLogName.SESSION_RESUMED,
        );
    }

    /** Stops after draining final cancellation and completed-state events. */
    public async stop(authenticatedUserId: number, sessionId: number): Promise<void> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        await this.registry.transitionSession(
            authenticatedUserId,
            sessionId,
            context,
            InterviewSessionStatus.STOPPING,
        );
        context.runtime.stopAcceptingEvents();
        await this.answerPipeline.cancelActiveAnswer(sessionId, context.runtime, context.publisher, 'SESSION_STOPPED');
        await this.registry.transitionSession(
            authenticatedUserId,
            sessionId,
            context,
            InterviewSessionStatus.COMPLETED,
        );
        this.recordMetric(InterviewLifecycleLogName.SESSION_COMPLETED, sessionId, {
            status: InterviewSessionStatus.COMPLETED,
        });
        context.runtime.clearAllAnswerTimers();
        await context.publisher.close();
    }

    /** Fails an owned active session using only a validated uppercase safe code. */
    public async fail(authenticatedUserId: number, sessionId: number, safeCode: string): Promise<void> {
        if (!isSafeInterviewCode(safeCode)) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.INVALID_FAILURE_CODE);
        }
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        await this.failRuntime(authenticatedUserId, sessionId, context, safeCode);
    }

    /** Reconciles and forwards each newly released transcript exactly once in semantic order. */
    public async ingestTranscriptEvent(
        authenticatedUserId: number,
        sessionId: number,
        untrustedEvent: unknown,
    ): Promise<ReadonlyArray<TranscriptSegmentSnapshot>> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        return this.transcriptPipeline.ingest(sessionId, context, untrustedEvent);
    }

    /** Detects a question from an existing final segment and supersedes active answer work. */
    public async detectQuestion(
        authenticatedUserId: number,
        sessionId: number,
        segmentId: string,
    ): Promise<InterviewQuestionSnapshot> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        return this.transcriptPipeline.detectQuestion(sessionId, context, segmentId);
    }

    /** Starts a securely identified answer request for an owned detected question. */
    public async requestAnswer(
        authenticatedUserId: number,
        sessionId: number,
        questionId: string,
    ): Promise<InterviewAnswerSnapshot> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        context.runtime.requireAcceptingEvents();
        const question = context.runtime.getQuestion(questionId);
        if (question === undefined) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.QUESTION_NOT_FOUND);
        }
        return this.answerPipeline.requestAnswer(sessionId, context.runtime, context.publisher, question);
    }

    /** Returns bounded orchestration state after revalidating ownership. */
    public async getSnapshot(
        authenticatedUserId: number,
        sessionId: number,
    ): Promise<InterviewCoordinatorSnapshot> {
        return this.registry.getSnapshot(authenticatedUserId, sessionId);
    }

    private async transitionWithMetric(
        authenticatedUserId: number,
        sessionId: number,
        status: InterviewSessionStatus,
        metricName: InterviewLifecycleLogName,
    ): Promise<void> {
        const context = await this.registry.requireOwnedContext(authenticatedUserId, sessionId);
        await this.registry.transitionSession(authenticatedUserId, sessionId, context, status);
        this.recordMetric(metricName, sessionId, { status });
    }

    private async failRuntime(
        authenticatedUserId: number,
        sessionId: number,
        context: InterviewSessionContext,
        safeCode: string,
    ): Promise<void> {
        context.runtime.stopAcceptingEvents();
        try {
            await this.answerPipeline.cancelActiveAnswer(
                sessionId,
                context.runtime,
                context.publisher,
                'SESSION_FAILED',
            );
        } catch {
            // Failure persistence and cleanup take precedence over cancellation notification.
        }
        try {
            await this.registry.transitionSession(
                authenticatedUserId,
                sessionId,
                context,
                InterviewSessionStatus.FAILED,
                safeCode,
            );
            this.recordMetric(InterviewLifecycleLogName.SESSION_FAILED, sessionId, {
                status: InterviewSessionStatus.FAILED,
                code: safeCode,
            });
        } finally {
            context.runtime.clearAllAnswerTimers();
            await context.publisher.close();
        }
    }

    private async publishCurrentSessionState(context: InterviewSessionContext): Promise<void> {
        await context.publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.SESSION_STATE_CHANGED,
            sessionId: context.runtime.machine.sessionId,
            sequenceNumber,
            payload: { status: context.runtime.machine.status },
        }));
    }

    private recordMetric(
        name: InterviewLifecycleLogName,
        sessionId: number,
        metadata: Omit<Parameters<InterviewLifecycleLogger['info']>[1], 'sessionId'> = {},
    ): void {
        this.lifecycleLogger.info(name, { sessionId, ...metadata });
    }
}
