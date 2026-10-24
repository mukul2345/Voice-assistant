import { InterviewSessionStatus } from '../../shared/interview/InterviewSession';
import { RealtimeEventType } from '../../shared/interview/RealtimeProtocol';
import {
    InterviewCoordinatorError,
    InterviewCoordinatorErrorCode,
    InterviewCoordinatorSnapshot,
    InterviewSessionOwnershipAccessor,
    OwnedInterviewSession,
} from './InterviewCoordinatorContracts';
import { InterviewEventPublisher } from './InterviewEventPublisher';
import { InterviewRealtimeTransportFactory } from './InterviewRealtimeTransport';
import { InterviewSessionRuntime } from './InterviewSessionRuntime';

export interface InterviewSessionContext {
    readonly runtime: InterviewSessionRuntime;
    readonly publisher: InterviewEventPublisher;
}

interface InterviewSessionRegistryOptions {
    readonly closeTimeoutMs: number;
    readonly maxSessions: number;
    readonly maxQuestions: number;
    readonly maxAnswers: number;
    readonly maxTranscriptSegments: number;
    readonly maxOutboundEvents: number;
}

/** Owns session lookup, tenant rechecks, persistence transitions, and runtime allocation. */
export class InterviewSessionRegistry {
    private readonly contexts = new Map<number, InterviewSessionContext>();

    public constructor(
        private readonly ownershipAccessor: InterviewSessionOwnershipAccessor,
        private readonly transportFactory: InterviewRealtimeTransportFactory,
        private readonly options: InterviewSessionRegistryOptions,
    ) {}

    public async openContext(
        authenticatedUserId: number,
        sessionId: number,
    ): Promise<{ readonly context: InterviewSessionContext; readonly ownedSession: OwnedInterviewSession }> {
        const ownedSession = await this.requireOwnedSession(authenticatedUserId, sessionId);
        if (this.contexts.has(sessionId)) {
            throw new InterviewCoordinatorError(
                InterviewCoordinatorErrorCode.SESSION_ALREADY_INITIALIZED,
            );
        }
        if (this.contexts.size >= this.options.maxSessions) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.CAPACITY_EXCEEDED);
        }
        const context = this.createContext(ownedSession);
        this.contexts.set(sessionId, context);
        return { context, ownedSession };
    }
    public async requireOwnedContext(
        authenticatedUserId: number,
        sessionId: number,
    ): Promise<InterviewSessionContext> {
        const ownedSession = await this.requireOwnedSession(authenticatedUserId, sessionId);
        const context = this.contexts.get(sessionId);
        if (context === undefined) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.SESSION_NOT_INITIALIZED);
        }
        context.runtime.synchronize(ownedSession.status);
        return context;
    }

    public async getSnapshot(
        authenticatedUserId: number,
        sessionId: number,
    ): Promise<InterviewCoordinatorSnapshot> {
        const ownedSession = await this.requireOwnedSession(authenticatedUserId, sessionId);
        const context = this.contexts.get(sessionId);
        if (context === undefined) {
            return {
                sessionId,
                status: ownedSession.status,
                failureCode: ownedSession.failureCode,
                transcripts: [],
                questions: [],
                answers: [],
            };
        }
        context.runtime.synchronize(ownedSession.status);
        return context.runtime.createSnapshot(sessionId, ownedSession.status, ownedSession.failureCode);
    }

    public async transitionSession(
        authenticatedUserId: number,
        sessionId: number,
        context: InterviewSessionContext,
        status: InterviewSessionStatus,
        failureCode?: string | null,
    ): Promise<void> {
        context.runtime.machine.transitionTo(status);
        const updated = await this.ownershipAccessor.updateSessionForUser(
            sessionId,
            authenticatedUserId,
            { status, failureCode },
        );
        if (updated === undefined) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.SESSION_NOT_FOUND);
        }
        await this.publishSessionState(context);
    }

    private async requireOwnedSession(
        authenticatedUserId: number,
        sessionId: number,
    ): Promise<OwnedInterviewSession> {
        const ownedSession = await this.ownershipAccessor.getSessionForUser(sessionId, authenticatedUserId);
        if (ownedSession === undefined) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.SESSION_NOT_FOUND);
        }
        return ownedSession;
    }
    private createContext(ownedSession: OwnedInterviewSession): InterviewSessionContext {
        const runtime = new InterviewSessionRuntime(ownedSession, {
            maxQuestions: this.options.maxQuestions,
            maxAnswers: this.options.maxAnswers,
            maxTranscriptSegments: this.options.maxTranscriptSegments,
        });
        const transport = this.transportFactory.create(String(ownedSession.id));
        return {
            runtime,
            publisher: new InterviewEventPublisher(
                transport,
                this.options.maxOutboundEvents,
                this.options.closeTimeoutMs,
            ),
        };
    }

    private async publishSessionState(context: InterviewSessionContext): Promise<void> {
        await context.publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.SESSION_STATE_CHANGED,
            sessionId: context.runtime.machine.sessionId,
            sequenceNumber,
            payload: { status: context.runtime.machine.status },
        }));
    }
}
