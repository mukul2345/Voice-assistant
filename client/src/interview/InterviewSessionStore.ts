import {
    AnswerStatus,
    InterviewSessionStatus,
    QuestionStatus,
} from '@shared/interview/InterviewSession';
import {
    parseRealtimeEvent,
    RealtimeEvent,
    RealtimeEventType,
    RealtimeProtocolError,
} from '@shared/interview/RealtimeProtocol';
import {
    RealtimeEventSequencer,
    SequencerDisposition,
} from '@shared/interview/RealtimeEventSequencer';

/**
 * Browser-safe, framework-agnostic realtime interview session state.
 *
 * The store consumes the shared realtime event contract through the shared
 * sequencer, derives all UI booleans from the current status, rejects stale or
 * mismatched answer events, and keeps every retained structure bounded. It never
 * controls a WebSocket, MediaRecorder, database, or provider directly.
 */

/** Connection lifecycle to the realtime transport, tracked independently of session status. */
export enum InterviewConnectionStatus {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    CLOSED = 'CLOSED',
}

/** Audio capture lifecycle, tracked independently of the session state machine. */
export enum InterviewAudioStatus {
    IDLE = 'IDLE',
    CAPTURING = 'CAPTURING',
    SUSPENDED = 'SUSPENDED',
}

/** A bounded transcript segment held for display. */
export interface InterviewTranscriptView {
    readonly segmentId: string;
    readonly text: string;
    readonly isFinal: boolean;
}

/** The currently tracked question, if any. */
export interface InterviewQuestionView {
    readonly questionId: string;
    readonly segmentId: string;
    readonly text: string;
    readonly status: QuestionStatus;
}

/** The currently tracked answer, if any. */
export interface InterviewAnswerView {
    readonly answerId: string;
    readonly questionId: string;
    readonly requestId: string;
    readonly status: AnswerStatus;
    readonly text: string;
}

/** A client-safe error surfaced to the UI without provider or stack detail. */
export interface InterviewSafeError {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
}

/** Immutable snapshot of everything the UI renders. */
export interface InterviewSessionSnapshot {
    readonly sessionStatus: InterviewSessionStatus;
    readonly connectionStatus: InterviewConnectionStatus;
    readonly audioStatus: InterviewAudioStatus;
    readonly transcript: ReadonlyArray<InterviewTranscriptView>;
    readonly currentPartial: string;
    readonly currentQuestion: InterviewQuestionView | null;
    readonly currentAnswer: InterviewAnswerView | null;
    readonly error: InterviewSafeError | null;
    readonly isRecording: boolean;
    readonly isBusy: boolean;
    readonly canStart: boolean;
    readonly canStop: boolean;
    readonly isTerminal: boolean;
}

/** Bounded configuration for retained client state. */
export interface InterviewSessionStoreOptions {
    readonly sessionId: string;
    readonly maxTranscriptSegments?: number;
    readonly maxPartialLength?: number;
}

const DEFAULT_MAX_TRANSCRIPT_SEGMENTS = 200;
const DEFAULT_MAX_PARTIAL_LENGTH = 4096;

type SnapshotListener = (snapshot: InterviewSessionSnapshot) => void;

/** Holds bounded realtime session state and notifies subscribers on change. */
export class InterviewSessionStore {
    private readonly sessionId: string;
    private readonly maxTranscriptSegments: number;
    private readonly maxPartialLength: number;
    private readonly sequencer: RealtimeEventSequencer;
    private readonly finalSegments = new Map<string, InterviewTranscriptView>();
    private readonly finalSegmentOrder: string[] = [];
    private readonly listeners = new Set<SnapshotListener>();

    private sessionStatus = InterviewSessionStatus.CREATED;
    private connectionStatus = InterviewConnectionStatus.DISCONNECTED;
    private audioStatus = InterviewAudioStatus.IDLE;
    private currentPartial = '';
    private currentQuestion: InterviewQuestionView | null = null;
    private currentAnswer: InterviewAnswerView | null = null;
    private error: InterviewSafeError | null = null;
    private snapshot: InterviewSessionSnapshot;

    public constructor(options: InterviewSessionStoreOptions) {
        this.sessionId = options.sessionId;
        this.maxTranscriptSegments = Math.max(1, options.maxTranscriptSegments ?? DEFAULT_MAX_TRANSCRIPT_SEGMENTS);
        this.maxPartialLength = Math.max(1, options.maxPartialLength ?? DEFAULT_MAX_PARTIAL_LENGTH);
        this.sequencer = new RealtimeEventSequencer({ sessionId: this.sessionId });
        this.snapshot = this.buildSnapshot();
    }

    /** Returns the current immutable snapshot. */
    public getSnapshot(): InterviewSessionSnapshot {
        return this.snapshot;
    }

    /** Subscribes to snapshot changes and returns an unsubscribe function. */
    public subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Records transport connection status without touching the session state machine. */
    public setConnectionStatus(connectionStatus: InterviewConnectionStatus): void {
        if (this.connectionStatus === connectionStatus) {
            return;
        }
        this.connectionStatus = connectionStatus;
        this.commit();
    }

    /** Records audio capture status without touching the session state machine. */
    public setAudioStatus(audioStatus: InterviewAudioStatus): void {
        if (this.audioStatus === audioStatus) {
            return;
        }
        this.audioStatus = audioStatus;
        this.commit();
    }

    /**
     * Ingests one untrusted realtime event. Malformed events are surfaced as a safe
     * error, cross-session and out-of-order events are dropped by the sequencer, and
     * stale or mismatched answer events are ignored.
     */
    public ingest(untrustedEvent: unknown): void {
        let event: RealtimeEvent;
        try {
            event = parseRealtimeEvent(untrustedEvent);
        } catch (cause: unknown) {
            this.error = {
                code: cause instanceof RealtimeProtocolError ? cause.code : 'MALFORMED_EVENT',
                message: 'A realtime update could not be processed.',
                retryable: false,
            };
            this.commit();
            return;
        }
        const result = this.sequencer.sequence(event);
        if (result.disposition !== SequencerDisposition.RELEASED) {
            return;
        }
        let changed = false;
        for (const releasedEvent of result.releasedEvents) {
            changed = this.applyEvent(releasedEvent) || changed;
        }
        if (changed) {
            this.commit();
        }
    }

    private applyEvent(event: RealtimeEvent): boolean {
        switch (event.type) {
            case RealtimeEventType.SESSION_STATE_CHANGED:
                return this.applySessionState(event.payload.status);
            case RealtimeEventType.TRANSCRIPT_PARTIAL:
                return this.applyPartialTranscript(event.payload.text);
            case RealtimeEventType.TRANSCRIPT_FINAL:
                return this.applyFinalTranscript(event.payload.segmentId, event.payload.text);
            case RealtimeEventType.QUESTION_DETECTED:
                return this.applyQuestionDetected(event.payload);
            case RealtimeEventType.QUESTION_STATE_CHANGED:
                return this.applyQuestionState(event.payload.questionId, event.payload.status);
            case RealtimeEventType.ANSWER_STARTED:
                return this.applyAnswerStarted(event.payload);
            case RealtimeEventType.ANSWER_CHUNK:
                return this.applyAnswerChunk(event.payload);
            case RealtimeEventType.ANSWER_COMPLETED:
                return this.applyAnswerTerminal(event.payload, AnswerStatus.COMPLETED);
            case RealtimeEventType.ANSWER_FAILED:
                return this.applyAnswerTerminal(event.payload, AnswerStatus.FAILED);
            case RealtimeEventType.ANSWER_CANCELLED:
                return this.applyAnswerTerminal(event.payload, AnswerStatus.CANCELLED);
            case RealtimeEventType.ERROR:
                this.error = {
                    code: event.payload.code,
                    message: event.payload.message,
                    retryable: event.payload.retryable,
                };
                return true;
            default:
                return false;
        }
    }

    private applySessionState(status: InterviewSessionStatus): boolean {
        if (this.sessionStatus === status) {
            return false;
        }
        this.sessionStatus = status;
        return true;
    }

    private applyPartialTranscript(text: string): boolean {
        const bounded = text.slice(0, this.maxPartialLength);
        if (this.currentPartial === bounded) {
            return false;
        }
        this.currentPartial = bounded;
        return true;
    }

    private applyFinalTranscript(segmentId: string, text: string): boolean {
        this.currentPartial = '';
        if (this.finalSegments.has(segmentId)) {
            return true;
        }
        this.finalSegments.set(segmentId, { segmentId, text, isFinal: true });
        this.finalSegmentOrder.push(segmentId);
        this.trimTranscript();
        return true;
    }

    private applyQuestionDetected(payload: {
        readonly questionId: string;
        readonly segmentId: string;
        readonly text: string;
    }): boolean {
        this.currentQuestion = {
            questionId: payload.questionId,
            segmentId: payload.segmentId,
            text: payload.text,
            status: QuestionStatus.DETECTED,
        };
        this.currentAnswer = null;
        return true;
    }

    private applyQuestionState(questionId: string, status: QuestionStatus): boolean {
        if (this.currentQuestion === null || this.currentQuestion.questionId !== questionId) {
            return false;
        }
        this.currentQuestion = { ...this.currentQuestion, status };
        return true;
    }

    private applyAnswerStarted(payload: {
        readonly questionId: string;
        readonly answerId: string;
        readonly requestId: string;
    }): boolean {
        if (this.currentQuestion === null || this.currentQuestion.questionId !== payload.questionId) {
            return false;
        }
        this.currentAnswer = {
            answerId: payload.answerId,
            questionId: payload.questionId,
            requestId: payload.requestId,
            status: AnswerStatus.STREAMING,
            text: '',
        };
        return true;
    }

    private applyAnswerChunk(payload: {
        readonly questionId: string;
        readonly answerId: string;
        readonly requestId: string;
        readonly text: string;
    }): boolean {
        if (!this.isCurrentAnswer(payload) || this.currentAnswer === null) {
            return false;
        }
        const nextText = (this.currentAnswer.text + payload.text).slice(0, this.maxPartialLength);
        this.currentAnswer = { ...this.currentAnswer, text: nextText };
        return true;
    }

    private applyAnswerTerminal(
        payload: { readonly questionId: string; readonly answerId: string; readonly requestId: string },
        status: AnswerStatus,
    ): boolean {
        if (!this.isCurrentAnswer(payload) || this.currentAnswer === null) {
            return false;
        }
        this.currentAnswer = { ...this.currentAnswer, status };
        return true;
    }

    private isCurrentAnswer(identity: {
        readonly questionId: string;
        readonly answerId: string;
        readonly requestId: string;
    }): boolean {
        return this.currentAnswer !== null
            && this.currentAnswer.answerId === identity.answerId
            && this.currentAnswer.questionId === identity.questionId
            && this.currentAnswer.requestId === identity.requestId;
    }

    private trimTranscript(): void {
        while (this.finalSegmentOrder.length > this.maxTranscriptSegments) {
            const expiredSegmentId = this.finalSegmentOrder.shift();
            if (expiredSegmentId !== undefined) {
                this.finalSegments.delete(expiredSegmentId);
            }
        }
    }

    private commit(): void {
        this.snapshot = this.buildSnapshot();
        Array.from(this.listeners).forEach((listener) => listener(this.snapshot));
    }

    private buildSnapshot(): InterviewSessionSnapshot {
        const status = this.sessionStatus;
        const isTerminal = status === InterviewSessionStatus.COMPLETED
            || status === InterviewSessionStatus.FAILED;
        const isRecording = status === InterviewSessionStatus.RECORDING;
        const isBusy = status === InterviewSessionStatus.INITIALIZING
            || status === InterviewSessionStatus.PROCESSING
            || status === InterviewSessionStatus.STOPPING;
        return {
            sessionStatus: status,
            connectionStatus: this.connectionStatus,
            audioStatus: this.audioStatus,
            transcript: this.finalSegmentOrder.flatMap((segmentId) => {
                const segment = this.finalSegments.get(segmentId);
                return segment === undefined ? [] : [segment];
            }),
            currentPartial: this.currentPartial,
            currentQuestion: this.currentQuestion,
            currentAnswer: this.currentAnswer,
            error: this.error,
            isRecording,
            isBusy,
            canStart: status === InterviewSessionStatus.READY || status === InterviewSessionStatus.PAUSED,
            canStop: !isTerminal
                && status !== InterviewSessionStatus.CREATED
                && status !== InterviewSessionStatus.INITIALIZING,
            isTerminal,
        };
    }
}
