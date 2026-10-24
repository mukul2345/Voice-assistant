import {
    AnswerGenerationChunk,
    AnswerGenerationFailure,
    AnswerGenerationIdentity,
    AnswerGenerationRequest,
    InterviewAnswerProvider,
    InterviewTranscriptionProvider,
    TranscriptionInput,
    TranscriptionRequest,
} from '../InterviewProviders';
import {
    InterviewRealtimeTransport,
    InterviewRealtimeTransportFactory,
} from '../InterviewRealtimeTransport';
import { RealtimeEvent, Speaker } from '../../../shared/interview/RealtimeProtocol';

/** Deterministic in-memory answer provider with explicit callback control. */
export class MockAnswerProvider implements InterviewAnswerProvider {
    private readonly requests = new Map<string, AnswerGenerationRequest>();
    private readonly requestOrder: string[] = [];
    private readonly cancelledRequestIds = new Set<string>();

    public constructor(private readonly maxRetainedRequests = 100) {}

    /** Captures a request without completing it. */
    public async generate(request: AnswerGenerationRequest): Promise<void> {
        this.requests.set(request.requestId, request);
        this.requestOrder.push(request.requestId);
        request.signal.addEventListener('abort', () => this.cancelledRequestIds.add(request.requestId), {
            once: true,
        });
        if (request.signal.aborted) {
            this.cancelledRequestIds.add(request.requestId);
        }
        this.trimRequests();
    }

    /** Emits a provider chunk with exact request identity. */
    public emitChunk(requestId: string, text: string): void {
        const request = this.requireRequest(requestId);
        const chunk: AnswerGenerationChunk = { ...this.identityOf(request), text };
        request.observer.onChunk(chunk);
    }

    /** Completes a captured request. */
    public complete(requestId: string): void {
        const request = this.requireRequest(requestId);
        request.observer.onComplete(this.identityOf(request));
    }

    /** Fails a captured request with a safe code. */
    public fail(requestId: string, code = 'PROVIDER_FAILED'): void {
        const request = this.requireRequest(requestId);
        const failure: AnswerGenerationFailure = { ...this.identityOf(request), code };
        request.observer.onFailure(failure);
    }

    /** Returns whether cancellation was observed for a request. */
    public wasCancelled(requestId: string): boolean {
        return this.cancelledRequestIds.has(requestId);
    }

    /** Returns retained request IDs in deterministic insertion order. */
    public get retainedRequestIds(): ReadonlyArray<string> {
        return [...this.requestOrder];
    }

    private requireRequest(requestId: string): AnswerGenerationRequest {
        const request = this.requests.get(requestId);
        if (request === undefined) {
            throw new RangeError('Unknown mock answer request.');
        }
        return request;
    }

    private identityOf(request: AnswerGenerationRequest): AnswerGenerationIdentity {
        return {
            sessionId: request.sessionId,
            questionId: request.questionId,
            answerId: request.answerId,
            requestId: request.requestId,
        };
    }

    private trimRequests(): void {
        while (this.requestOrder.length > this.maxRetainedRequests) {
            const requestId = this.requestOrder.shift();
            if (requestId !== undefined) {
                this.requests.delete(requestId);
                this.cancelledRequestIds.delete(requestId);
            }
        }
    }
}
/** Deterministic transcription provider able to emit bounded partial/final inputs. */
export class MockTranscriptionProvider implements InterviewTranscriptionProvider {
    private readonly requests = new Map<string, TranscriptionRequest>();
    private readonly sessionOrder: string[] = [];

    public constructor(private readonly maxRetainedSessions = 20) {}

    /** Captures a transcription stream request. */
    public async transcribe(request: TranscriptionRequest): Promise<void> {
        this.requests.set(request.sessionId, request);
        this.sessionOrder.push(request.sessionId);
        this.trimRequests();
    }

    /** Emits one deterministic partial transcript input. */
    public emitPartial(options: {
        readonly sessionId: string;
        readonly segmentId: string;
        readonly sequenceNumber: number;
        readonly text: string;
        readonly speaker?: Speaker;
    }): void {
        this.emit({ ...options, speaker: options.speaker ?? Speaker.UNKNOWN, isFinal: false });
    }

    /** Emits one deterministic final transcript input. */
    public emitFinal(options: {
        readonly sessionId: string;
        readonly segmentId: string;
        readonly sequenceNumber: number;
        readonly text: string;
        readonly speaker?: Speaker;
    }): void {
        this.emit({ ...options, speaker: options.speaker ?? Speaker.UNKNOWN, isFinal: true });
    }

    private emit(input: TranscriptionInput): void {
        const request = this.requests.get(input.sessionId);
        if (request === undefined) {
            throw new RangeError('Unknown mock transcription session.');
        }
        if (!request.signal.aborted) {
            request.observer.onInput(input);
        }
    }

    private trimRequests(): void {
        while (this.sessionOrder.length > this.maxRetainedSessions) {
            const sessionId = this.sessionOrder.shift();
            if (sessionId !== undefined) {
                this.requests.delete(sessionId);
            }
        }
    }
}

/** In-memory transport retaining a bounded deterministic event history. */
export class InMemoryInterviewTransport implements InterviewRealtimeTransport {
    private readonly retainedEvents: RealtimeEvent[] = [];
    private isConnected = false;
    private closeCalls = 0;

    public constructor(
        public readonly sessionId: string,
        private readonly maxRetainedEvents = 500,
    ) {}

    /** Marks the transport connected. */
    public async connect(): Promise<void> {
        this.isConnected = true;
    }

    /** Retains a validated event while connected. */
    public async send(event: RealtimeEvent): Promise<void> {
        if (!this.isConnected) {
            throw new Error('Mock transport is not connected.');
        }
        this.retainedEvents.push(event);
        while (this.retainedEvents.length > this.maxRetainedEvents) {
            this.retainedEvents.shift();
        }
    }

    /** Idempotently marks the transport closed and records close invocation count. */
    public async close(): Promise<void> {
        this.closeCalls += 1;
        this.isConnected = false;
    }

    /** Returns retained events in send order. */
    public get events(): ReadonlyArray<RealtimeEvent> {
        return [...this.retainedEvents];
    }

    /** Returns whether the channel is currently connected. */
    public get connected(): boolean {
        return this.isConnected;
    }

    /** Returns the number of physical close invocations. */
    public get closeCount(): number {
        return this.closeCalls;
    }
}

/** Deterministic factory retaining a bounded set of in-memory transports. */
export class InMemoryInterviewTransportFactory implements InterviewRealtimeTransportFactory {
    private readonly transports = new Map<string, InMemoryInterviewTransport>();
    private readonly sessionOrder: string[] = [];

    public constructor(
        private readonly maxRetainedSessions = 20,
        private readonly maxRetainedEvents = 500,
    ) {}

    /** Creates and retains one transport for a session. */
    public create(sessionId: string): InMemoryInterviewTransport {
        const transport = new InMemoryInterviewTransport(sessionId, this.maxRetainedEvents);
        this.creations += 1;
        this.transports.set(sessionId, transport);
        this.sessionOrder.push(sessionId);
        this.trimTransports();
        return transport;
    }

    /** Returns the retained transport for a session, when present. */
    public getTransport(sessionId: string): InMemoryInterviewTransport | undefined {
        return this.transports.get(sessionId);
    }

    /** Returns the total number of transports created, including any later evicted. */
    public get createdCount(): number {
        return this.creations;
    }
    private creations = 0;

    private trimTransports(): void {
        while (this.sessionOrder.length > this.maxRetainedSessions) {
            const sessionId = this.sessionOrder.shift();
            if (sessionId !== undefined) {
                this.transports.delete(sessionId);
            }
        }
    }
}
