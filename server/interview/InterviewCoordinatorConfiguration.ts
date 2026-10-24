import {
    InterviewSessionCoordinatorOptions,
    requirePositiveInteger,
} from './InterviewCoordinatorContracts';

const DEFAULT_TRANSPORT_TIMEOUT_MS = 5_000;
const DEFAULT_ANSWER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_RECORDS = 100;
const DEFAULT_MAX_ANSWER_BYTES = 64 * 1024;
const DEFAULT_MAX_CHUNK_BYTES = 32 * 1024;
const DEFAULT_MAX_OUTBOUND_EVENTS = 256;

/** Fully validated bounded coordinator configuration. */
export interface InterviewCoordinatorConfiguration {
    readonly connectTimeoutMs: number;
    readonly closeTimeoutMs: number;
    readonly answerTimeoutMs: number;
    readonly maxSessions: number;
    readonly maxQuestions: number;
    readonly maxAnswers: number;
    readonly maxTranscriptSegments: number;
    readonly maxAnswerBytes: number;
    readonly maxChunkBytes: number;
    readonly maxOutboundEvents: number;
}

/** Validates optional coordinator settings and supplies production defaults. */
export function createInterviewCoordinatorConfiguration(
    options: InterviewSessionCoordinatorOptions,
): InterviewCoordinatorConfiguration {
    return {
        connectTimeoutMs: requirePositiveInteger(
            options.connectTimeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS,
            'connectTimeoutMs',
        ),
        closeTimeoutMs: requirePositiveInteger(
            options.closeTimeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS,
            'closeTimeoutMs',
        ),
        answerTimeoutMs: requirePositiveInteger(
            options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS,
            'answerTimeoutMs',
        ),
        maxSessions: requirePositiveInteger(options.maxSessions ?? DEFAULT_MAX_SESSIONS, 'maxSessions'),
        maxQuestions: requirePositiveInteger(
            options.maxQuestionsPerSession ?? DEFAULT_MAX_RECORDS,
            'maxQuestionsPerSession',
        ),
        maxAnswers: requirePositiveInteger(
            options.maxAnswersPerSession ?? DEFAULT_MAX_RECORDS,
            'maxAnswersPerSession',
        ),
        maxTranscriptSegments: requirePositiveInteger(
            options.maxTranscriptSegments ?? DEFAULT_MAX_RECORDS,
            'maxTranscriptSegments',
        ),
        maxAnswerBytes: requirePositiveInteger(
            options.maxAnswerBytes ?? DEFAULT_MAX_ANSWER_BYTES,
            'maxAnswerBytes',
        ),
        maxChunkBytes: requirePositiveInteger(
            options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES,
            'maxChunkBytes',
        ),
        maxOutboundEvents: requirePositiveInteger(
            options.maxOutboundEvents ?? DEFAULT_MAX_OUTBOUND_EVENTS,
            'maxOutboundEvents',
        ),
    };
}
