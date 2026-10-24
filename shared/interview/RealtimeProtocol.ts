import { z } from 'zod';

import { InterviewSessionStatus, QuestionStatus } from './InterviewSession';

/** Current wire-protocol version. */
export const REALTIME_PROTOCOL_VERSION = 1 as const;

/** Maximum UTF-8 size accepted for one serialized event. */
export const MAX_REALTIME_EVENT_BYTES = 64 * 1024;

/** Speakers recognized in transcript events. */
export enum Speaker {
    UNKNOWN = 'UNKNOWN',
    INTERVIEWER = 'INTERVIEWER',
    CANDIDATE = 'CANDIDATE',
}

/** Event discriminants supported by protocol version 1. */
export enum RealtimeEventType {
    SESSION_STATE_CHANGED = 'SESSION_STATE_CHANGED',
    TRANSCRIPT_PARTIAL = 'TRANSCRIPT_PARTIAL',
    TRANSCRIPT_FINAL = 'TRANSCRIPT_FINAL',
    QUESTION_DETECTED = 'QUESTION_DETECTED',
    QUESTION_STATE_CHANGED = 'QUESTION_STATE_CHANGED',
    ANSWER_STARTED = 'ANSWER_STARTED',
    ANSWER_CHUNK = 'ANSWER_CHUNK',
    ANSWER_COMPLETED = 'ANSWER_COMPLETED',
    ANSWER_FAILED = 'ANSWER_FAILED',
    ANSWER_CANCELLED = 'ANSWER_CANCELLED',
    ERROR = 'ERROR',
}

/** Stable categories for protocol validation failures. */
export enum RealtimeProtocolErrorCode {
    MALFORMED_EVENT = 'MALFORMED_EVENT',
    EVENT_TOO_LARGE = 'EVENT_TOO_LARGE',
}

/** Safe validation error that does not expose event contents. */
export class RealtimeProtocolError extends Error {
    public constructor(
        public readonly code: RealtimeProtocolErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'RealtimeProtocolError';
    }
}

const identifierSchema = z.string().uuid();
const sessionIdentifierSchema = z.string().min(1).max(128);
const nonEmptyTextSchema = z.string().min(1).max(32 * 1024);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const baseEventSchema = z.object({
    version: z.literal(REALTIME_PROTOCOL_VERSION),
    eventId: identifierSchema,
    sessionId: sessionIdentifierSchema,
    timestamp: z.number().int().nonnegative(),
    sequenceNumber: z.number().int().nonnegative(),
}).strict();

const transcriptPayloadSchema = z.object({
    segmentId: identifierSchema,
    speaker: z.nativeEnum(Speaker),
    text: nonEmptyTextSchema,
}).strict();

const answerIdentitySchema = z.object({
    questionId: identifierSchema,
    answerId: identifierSchema,
    requestId: identifierSchema,
});

/** Schema for a session state event. */
export const sessionStateChangedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.SESSION_STATE_CHANGED),
    payload: z.object({ status: z.nativeEnum(InterviewSessionStatus) }).strict(),
}).strict();

/** Schema for a replaceable partial transcript event. */
export const transcriptPartialEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.TRANSCRIPT_PARTIAL),
    payload: transcriptPayloadSchema,
}).strict();

/** Schema for an immutable final transcript event. */
export const transcriptFinalEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.TRANSCRIPT_FINAL),
    payload: transcriptPayloadSchema,
}).strict();

/** Schema for a newly detected question event. */
export const questionDetectedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.QUESTION_DETECTED),
    payload: z.object({
        questionId: identifierSchema,
        segmentId: identifierSchema,
        text: nonEmptyTextSchema,
    }).strict(),
}).strict();

/** Schema for a question lifecycle event. */
export const questionStateChangedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.QUESTION_STATE_CHANGED),
    payload: z.object({
        questionId: identifierSchema,
        status: z.nativeEnum(QuestionStatus),
    }).strict(),
}).strict();

/** Schema emitted when answer streaming starts. */
export const answerStartedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ANSWER_STARTED),
    payload: answerIdentitySchema.strict(),
}).strict();

/** Schema for one streaming answer chunk. */
export const answerChunkEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ANSWER_CHUNK),
    payload: answerIdentitySchema.extend({ text: nonEmptyTextSchema }).strict(),
}).strict();

/** Schema emitted when an answer completes. */
export const answerCompletedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ANSWER_COMPLETED),
    payload: answerIdentitySchema.strict(),
}).strict();

/** Schema emitted when answer generation fails with a client-safe code. */
export const answerFailedEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ANSWER_FAILED),
    payload: answerIdentitySchema.extend({ code: safeCodeSchema }).strict(),
}).strict();

/** Schema emitted when answer generation is cancelled with a client-safe code. */
export const answerCancelledEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ANSWER_CANCELLED),
    payload: answerIdentitySchema.extend({ code: safeCodeSchema }).strict(),
}).strict();

/** Schema for a client-safe error event with no stack or arbitrary details. */
export const safeErrorEventSchema = baseEventSchema.extend({
    type: z.literal(RealtimeEventType.ERROR),
    payload: z.object({
        code: safeCodeSchema,
        message: z.string().min(1).max(512),
        retryable: z.boolean(),
        requestId: identifierSchema.optional(),
    }).strict(),
}).strict();

/** Strict discriminated union schema for all version-1 realtime events. */
export const realtimeEventSchema = z.discriminatedUnion('type', [
    sessionStateChangedEventSchema,
    transcriptPartialEventSchema,
    transcriptFinalEventSchema,
    questionDetectedEventSchema,
    questionStateChangedEventSchema,
    answerStartedEventSchema,
    answerChunkEventSchema,
    answerCompletedEventSchema,
    answerFailedEventSchema,
    answerCancelledEventSchema,
    safeErrorEventSchema,
]);

/** A validated event in version 1 of the realtime protocol. */
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

/** Metadata present on every realtime event. */
export type RealtimeEventMetadata = Pick<
    RealtimeEvent,
    'version' | 'eventId' | 'sessionId' | 'timestamp' | 'sequenceNumber'
>;

type GeneratedMetadataKey = 'version' | 'eventId' | 'timestamp';
type DistributiveOmit<Event, Key extends PropertyKey> = Event extends unknown
    ? Omit<Event, Extract<Key, keyof Event>>
    : never;

/** Input accepted by the event factory; generated metadata is intentionally omitted. */
export type RealtimeEventCreationInput = DistributiveOmit<
    RealtimeEvent,
    GeneratedMetadataKey
>;

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function serializeUnknown(input: unknown): string {
    try {
        const serializedInput = JSON.stringify(input);
        if (serializedInput === undefined) {
            throw new TypeError('Value is not JSON serializable.');
        }
        return serializedInput;
    } catch {
        throw new RealtimeProtocolError(
            RealtimeProtocolErrorCode.MALFORMED_EVENT,
            'Realtime event must be JSON serializable.',
        );
    }
}

function enforceSize(byteLength: number): void {
    if (byteLength > MAX_REALTIME_EVENT_BYTES) {
        throw new RealtimeProtocolError(
            RealtimeProtocolErrorCode.EVENT_TOO_LARGE,
            `Realtime event exceeds ${MAX_REALTIME_EVENT_BYTES} bytes.`,
        );
    }
}

/** Generates a cryptographically random UUID for protocol/domain identifiers. */
export function createRealtimeId(): string {
    return globalThis.crypto.randomUUID();
}

/** Creates and validates a version-1 event with secure ID and epoch millisecond metadata. */
export function createRealtimeEvent(input: RealtimeEventCreationInput): RealtimeEvent {
    return parseRealtimeEvent({
        ...input,
        version: REALTIME_PROTOCOL_VERSION,
        eventId: createRealtimeId(),
        timestamp: Date.now(),
    });
}

/** Validates an object or serialized value, including the 64 KiB wire-size limit. */
export function parseRealtimeEvent(input: unknown): RealtimeEvent {
    let candidate: unknown = input;
    if (typeof input === 'string') {
        enforceSize(utf8ByteLength(input));
        try {
            candidate = JSON.parse(input) as unknown;
        } catch {
            throw new RealtimeProtocolError(
                RealtimeProtocolErrorCode.MALFORMED_EVENT,
                'Realtime event is not valid JSON.',
            );
        }
    } else {
        enforceSize(utf8ByteLength(serializeUnknown(input)));
    }

    const validation = realtimeEventSchema.safeParse(candidate);
    if (!validation.success) {
        throw new RealtimeProtocolError(
            RealtimeProtocolErrorCode.MALFORMED_EVENT,
            'Realtime event does not match protocol version 1.',
        );
    }
    return validation.data;
}

/** Serializes a validated event while enforcing the wire-size limit. */
export function serializeRealtimeEvent(event: RealtimeEvent): string {
    const validatedEvent = parseRealtimeEvent(event);
    const serializedEvent = serializeUnknown(validatedEvent);
    enforceSize(utf8ByteLength(serializedEvent));
    return serializedEvent;
}