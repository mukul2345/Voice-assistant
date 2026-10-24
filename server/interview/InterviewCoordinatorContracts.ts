import type { Storage } from '../storage';
import { InterviewSessionStatus, AnswerStatus, QuestionStatus } from '../../shared/interview/InterviewSession';
import { TranscriptSegmentSnapshot } from '../../shared/interview/TranscriptReconciler';
import { logger as safeLogger } from '../logging/SafeLogger';

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Stable safe coordinator failure categories. */
export enum InterviewCoordinatorErrorCode {
    SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
    SESSION_NOT_INITIALIZED = 'SESSION_NOT_INITIALIZED',
    SESSION_ALREADY_INITIALIZED = 'SESSION_ALREADY_INITIALIZED',
    SESSION_MISMATCH = 'SESSION_MISMATCH',
    SESSION_TERMINAL = 'SESSION_TERMINAL',
    UNSUPPORTED_EVENT = 'UNSUPPORTED_EVENT',
    FINAL_TRANSCRIPT_REQUIRED = 'FINAL_TRANSCRIPT_REQUIRED',
    QUESTION_NOT_FOUND = 'QUESTION_NOT_FOUND',
    ANSWER_NOT_FOUND = 'ANSWER_NOT_FOUND',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
    INVALID_FAILURE_CODE = 'INVALID_FAILURE_CODE',
    TRANSPORT_TIMEOUT = 'TRANSPORT_TIMEOUT',
}

/** Safe orchestration error that never reveals ownership or provider details. */
export class InterviewCoordinatorError extends Error {
    public constructor(public readonly code: InterviewCoordinatorErrorCode) {
        super(code === InterviewCoordinatorErrorCode.SESSION_NOT_FOUND
            ? 'The requested session was not found.'
            : 'The interview operation could not be completed.');
        this.name = 'InterviewCoordinatorError';
    }
}

/** Minimal owned session view compatible with storage session rows. */
export interface OwnedInterviewSession {
    readonly id: number;
    readonly userId: number;
    readonly status: InterviewSessionStatus;
    readonly failureCode: string | null;
}

/** Status fields persisted atomically through the ownership boundary. */
export interface InterviewSessionPersistenceUpdate {
    readonly status: InterviewSessionStatus;
    readonly failureCode?: string | null;
}
/** Tenant-scoped accessor structurally compatible with storage session methods. */
export interface InterviewSessionOwnershipAccessor {
    getSessionForUser(sessionId: number, userId: number): Promise<OwnedInterviewSession | undefined>;
    updateSessionForUser(
        sessionId: number,
        userId: number,
        updates: InterviewSessionPersistenceUpdate,
    ): Promise<OwnedInterviewSession | undefined>;
}

type AssertAccessorCompatibility<Expected, Actual extends Expected> = Actual;

/** Compile-time proof that the real storage methods satisfy the coordinator boundary. */
export type InterviewStorageAccessorCompatibility = AssertAccessorCompatibility<
    InterviewSessionOwnershipAccessor,
    Pick<Storage, 'getSessionForUser' | 'updateSessionForUser'>
>;

/** Exact metric names emitted by interview orchestration. */
export enum InterviewLifecycleLogName {
    SESSION_CREATED = 'session_created',
    SESSION_STARTED = 'session_started',
    SESSION_PAUSED = 'session_paused',
    SESSION_RESUMED = 'session_resumed',
    SESSION_COMPLETED = 'session_completed',
    SESSION_FAILED = 'session_failed',
    TRANSCRIPT_PARTIAL_RECEIVED = 'transcript_partial_received',
    TRANSCRIPT_FINAL_RECEIVED = 'transcript_final_received',
    QUESTION_DETECTED = 'question_detected',
    QUESTION_CANCELLED = 'question_cancelled',
    ANSWER_STARTED = 'answer_started',
    ANSWER_COMPLETED = 'answer_completed',
    ANSWER_FAILED = 'answer_failed',
    ANSWER_CANCELLED = 'answer_cancelled',
}

export type InterviewLifecycleMetadata = Readonly<{
    sessionId: number;
    questionId?: string;
    answerId?: string;
    requestId?: string;
    segmentId?: string;
    status?: string;
    code?: string;
}>;

/** Metadata-only metric sink accepted by orchestration. */
export interface InterviewLifecycleLogger {
    info(name: InterviewLifecycleLogName, metadata: InterviewLifecycleMetadata): void;
}
class SafeInterviewLifecycleLogger implements InterviewLifecycleLogger {
    public info(name: InterviewLifecycleLogName, metadata: InterviewLifecycleMetadata): void {
        safeLogger.info('Interview lifecycle metric.', { name, ...metadata });
    }
}

/** Default production metric sink backed by the existing redacting logger. */
export const defaultInterviewLifecycleLogger: InterviewLifecycleLogger =
    new SafeInterviewLifecycleLogger();

/** Bounded coordinator configuration. */
export interface InterviewSessionCoordinatorOptions {
    readonly connectTimeoutMs?: number;
    readonly closeTimeoutMs?: number;
    readonly answerTimeoutMs?: number;
    readonly maxSessions?: number;
    readonly maxQuestionsPerSession?: number;
    readonly maxAnswersPerSession?: number;
    readonly maxTranscriptSegments?: number;
    readonly maxAnswerBytes?: number;
    readonly maxChunkBytes?: number;
    readonly maxOutboundEvents?: number;
    readonly logger?: InterviewLifecycleLogger;
}

/** Read-only question view exposed to authenticated callers. */
export interface InterviewQuestionSnapshot {
    readonly questionId: string;
    readonly segmentId: string;
    readonly status: QuestionStatus;
}

/** Read-only answer view exposed to authenticated callers. */
export interface InterviewAnswerSnapshot {
    readonly answerId: string;
    readonly questionId: string;
    readonly requestId: string;
    readonly status: AnswerStatus;
    readonly text: string;
}

/** Bounded read-only view of coordinator state. */
export interface InterviewCoordinatorSnapshot {
    readonly sessionId: number;
    readonly status: InterviewSessionStatus;
    readonly failureCode: string | null;
    readonly transcripts: ReadonlyArray<TranscriptSegmentSnapshot>;
    readonly questions: ReadonlyArray<InterviewQuestionSnapshot>;
    readonly answers: ReadonlyArray<InterviewAnswerSnapshot>;
}

/** Validates a bounded positive integer option. */
export function requirePositiveInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer.`);
    }
    return value;
}

/** Returns whether a code is safe to persist or send to clients. */
export function isSafeInterviewCode(code: string): boolean {
    return SAFE_CODE_PATTERN.test(code);
}
