import { InterviewSessionStatus } from '../../../shared/interview/InterviewSession';
import {
    createRealtimeEvent,
    createRealtimeId,
    RealtimeEventType,
    Speaker,
} from '../../../shared/interview/RealtimeProtocol';
import {
    InterviewLifecycleLogger,
    InterviewLifecycleLogName,
    InterviewSessionCoordinator,
    InterviewSessionCoordinatorOptions,
    InterviewSessionOwnershipAccessor,
} from '../InterviewSessionCoordinator';
import { InterviewLifecycleMetadata } from '../InterviewCoordinatorContracts';
import { InMemoryInterviewTransportFactory, MockAnswerProvider } from './MockInterviewProviders';

interface StoredSession {
    readonly id: number;
    readonly userId: number;
    status: InterviewSessionStatus;
    failureCode: string | null;
}

export class MemoryInterviewAccessor implements InterviewSessionOwnershipAccessor {
    public readonly sessions = new Map<number, StoredSession>();

    public async getSessionForUser(sessionId: number, userId: number): Promise<StoredSession | undefined> {
        const session = this.sessions.get(sessionId);
        return session?.userId === userId ? session : undefined;
    }

    public async updateSessionForUser(
        sessionId: number,
        userId: number,
        updates: { readonly status: InterviewSessionStatus; readonly failureCode?: string | null },
    ): Promise<StoredSession | undefined> {
        const session = await this.getSessionForUser(sessionId, userId);
        if (session === undefined) {
            return undefined;
        }
        session.status = updates.status;
        if (updates.failureCode !== undefined) {
            session.failureCode = updates.failureCode;
        }
        return session;
    }
}
export interface RecordedLifecycleMetric {
    readonly name: InterviewLifecycleLogName;
    readonly metadata: InterviewLifecycleMetadata;
}

export class MemoryInterviewLifecycleLogger implements InterviewLifecycleLogger {
    public readonly metrics: RecordedLifecycleMetric[] = [];

    public info(name: InterviewLifecycleLogName, metadata: InterviewLifecycleMetadata): void {
        this.metrics.push({ name, metadata });
    }
}

export function createInterviewCoordinatorHarness(options: InterviewSessionCoordinatorOptions = {}) {
    const accessor = new MemoryInterviewAccessor();
    const provider = new MockAnswerProvider();
    const transports = new InMemoryInterviewTransportFactory();
    const lifecycleLogger = new MemoryInterviewLifecycleLogger();
    const coordinator = new InterviewSessionCoordinator(
        accessor,
        provider,
        transports,
        { logger: lifecycleLogger, ...options },
    );
    return { accessor, provider, transports, lifecycleLogger, coordinator };
}

export async function addInterviewSession(
    accessor: MemoryInterviewAccessor,
    id: number,
    userId: number,
): Promise<void> {
    accessor.sessions.set(id, {
        id,
        userId,
        status: InterviewSessionStatus.CREATED,
        failureCode: null,
    });
}

export async function initializeRecording(
    coordinator: InterviewSessionCoordinator,
    userId: number,
    sessionId: number,
): Promise<void> {
    await coordinator.initialize(userId, sessionId);
    await coordinator.start(userId, sessionId);
}
export async function ingestFinal(
    coordinator: InterviewSessionCoordinator,
    userId: number,
    sessionId: number,
    sequenceNumber: number,
    text = 'What is bounded orchestration?',
): Promise<string> {
    const segmentId = createRealtimeId();
    await coordinator.ingestTranscriptEvent(userId, sessionId, createRealtimeEvent({
        type: RealtimeEventType.TRANSCRIPT_FINAL,
        sessionId: String(sessionId),
        sequenceNumber,
        payload: { segmentId, speaker: Speaker.INTERVIEWER, text },
    }));
    return segmentId;
}

export async function flushInterviewCallbacks(delayMs = 0): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
