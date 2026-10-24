import {
    createRealtimeEvent,
    parseRealtimeEvent,
    RealtimeEvent,
    RealtimeEventCreationInput,
    RealtimeEventType,
} from '../../shared/interview/RealtimeProtocol';
import {
    InterviewCoordinatorError,
    InterviewCoordinatorErrorCode,
} from './InterviewCoordinatorContracts';
import { InterviewRealtimeTransport } from './InterviewRealtimeTransport';

interface QueuedInterviewEvent {
    readonly event: RealtimeEvent;
    readonly complete: () => void;
}

type SequencedEventFactory = (sequenceNumber: number) => RealtimeEventCreationInput;

/** Owns fresh outbound metadata, bounded iterative delivery, draining, and transport closure. */
export class InterviewEventPublisher {
    private readonly queue: QueuedInterviewEvent[] = [];
    private sequenceNumber = 0;
    private pendingSendCount = 0;
    private isConnected = false;
    private isClosing = false;
    private isClosed = false;
    private drainCompletion?: Promise<void>;

    public constructor(
        private readonly transport: InterviewRealtimeTransport,
        private readonly maxOutboundEvents: number,
        private readonly closeTimeoutMs: number,
    ) {}

    public async connect(connectTimeoutMs: number): Promise<void> {
        await this.withTimeout(this.transport.connect(), connectTimeoutMs);
        this.isConnected = true;
    }

    public async publish(createInput: SequencedEventFactory): Promise<void> {
        if (!this.isConnected || this.isClosing || this.isClosed) {
            return;
        }
        if (this.pendingSendCount >= this.maxOutboundEvents) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.CAPACITY_EXCEEDED);
        }
        const event = createRealtimeEvent(createInput(this.nextSequenceNumber()));
        await this.enqueue(event);
    }
    public async publishTranscript(event: RealtimeEvent): Promise<void> {
        if (event.type === RealtimeEventType.TRANSCRIPT_PARTIAL) {
            await this.publish((sequenceNumber) => ({
                type: RealtimeEventType.TRANSCRIPT_PARTIAL,
                sessionId: event.sessionId,
                sequenceNumber,
                payload: event.payload,
            }));
            return;
        }
        if (event.type === RealtimeEventType.TRANSCRIPT_FINAL) {
            await this.publish((sequenceNumber) => ({
                type: RealtimeEventType.TRANSCRIPT_FINAL,
                sessionId: event.sessionId,
                sequenceNumber,
                payload: event.payload,
            }));
        }
    }

    public async close(): Promise<void> {
        if (this.isClosed || this.isClosing) {
            if (this.drainCompletion !== undefined) {
                await this.drainCompletion;
            }
            return;
        }
        this.isClosing = true;
        if (this.drainCompletion !== undefined) {
            await this.drainCompletion;
        }
        try {
            await this.withTimeout(this.transport.close(), this.closeTimeoutMs);
        } catch {
            // Lifecycle completion remains deterministic when best-effort close times out.
        } finally {
            this.isConnected = false;
            this.isClosed = true;
            this.isClosing = false;
        }
    }

    private async enqueue(event: RealtimeEvent): Promise<void> {
        this.pendingSendCount += 1;
        await new Promise<void>((complete) => {
            this.queue.push({ event, complete });
            if (this.drainCompletion === undefined) {
                this.drainCompletion = this.drainQueue();
            }
        });
    }

    private async drainQueue(): Promise<void> {
        while (this.queue.length > 0) {
            const queuedEvent = this.queue.shift();
            if (queuedEvent === undefined) {
                continue;
            }
            try {
                await this.transport.send(parseRealtimeEvent(queuedEvent.event));
            } catch {
                // Delivery failures do not poison or recursively restart the bounded queue.
            } finally {
                this.pendingSendCount -= 1;
                queuedEvent.complete();
            }
        }
        this.drainCompletion = undefined;
    }
    private nextSequenceNumber(): number {
        this.sequenceNumber += 1;
        return this.sequenceNumber;
    }

    private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new InterviewCoordinatorError(
                InterviewCoordinatorErrorCode.TRANSPORT_TIMEOUT,
            )), timeoutMs);
        });
        try {
            return await Promise.race([operation, timeout]);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
}
