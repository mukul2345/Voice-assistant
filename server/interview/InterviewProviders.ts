import { Speaker } from '../../shared/interview/RealtimeProtocol';

/** Identity attached to every answer-provider callback. */
export interface AnswerGenerationIdentity {
    readonly sessionId: string;
    readonly questionId: string;
    readonly answerId: string;
    readonly requestId: string;
}

/** One bounded answer chunk returned by a provider. */
export interface AnswerGenerationChunk extends AnswerGenerationIdentity {
    readonly text: string;
}

/** A provider failure containing only a client-safe stable code. */
export interface AnswerGenerationFailure extends AnswerGenerationIdentity {
    readonly code: string;
}

/** Callback boundary used by answer providers; implementations enforce the declared limits. */
export interface BoundedAnswerChunkObserver {
    readonly maxChunkBytes: number;
    readonly maxAnswerBytes: number;
    onChunk(chunk: AnswerGenerationChunk): void;
    onComplete(identity: AnswerGenerationIdentity): void;
    onFailure(failure: AnswerGenerationFailure): void;
}

/** Complete provider-neutral input for one answer request. */
export interface AnswerGenerationRequest extends AnswerGenerationIdentity {
    readonly questionText: string;
    readonly signal: AbortSignal;
    readonly observer: BoundedAnswerChunkObserver;
}

/** Port implemented by any future streaming answer provider. */
export interface InterviewAnswerProvider {
    /** Starts generation and reports output only through the supplied bounded observer. */
    generate(request: AnswerGenerationRequest): Promise<void>;
}

/** Provider-neutral transcript input emitted by future transcription integrations. */
export interface TranscriptionInput {
    readonly sessionId: string;
    readonly segmentId: string;
    readonly sequenceNumber: number;
    readonly speaker: Speaker;
    readonly text: string;
    readonly isFinal: boolean;
}

/** Observer for untrusted partial/final inputs from a transcription provider. */
export interface TranscriptionInputObserver {
    onInput(input: TranscriptionInput): void;
}

/** Complete input for starting one future transcription stream. */
export interface TranscriptionRequest {
    readonly sessionId: string;
    readonly signal: AbortSignal;
    readonly observer: TranscriptionInputObserver;
}

/** Port implemented by any future transcription provider without vendor coupling. */
export interface InterviewTranscriptionProvider {
    /** Starts emitting partial and final transcript inputs until completion or cancellation. */
    transcribe(request: TranscriptionRequest): Promise<void>;
}
