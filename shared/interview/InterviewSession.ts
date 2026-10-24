/** States in the lifecycle of an interview session. */
export enum InterviewSessionStatus {
    CREATED = 'CREATED',
    INITIALIZING = 'INITIALIZING',
    READY = 'READY',
    RECORDING = 'RECORDING',
    PROCESSING = 'PROCESSING',
    PAUSED = 'PAUSED',
    STOPPING = 'STOPPING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

/** States in the lifecycle of an interview question. */
export enum QuestionStatus {
    DETECTED = 'DETECTED',
    PROCESSING = 'PROCESSING',
    ANSWERING = 'ANSWERING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

/** States in the lifecycle of an interview answer. */
export enum AnswerStatus {
    PENDING = 'PENDING',
    STREAMING = 'STREAMING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

/** Stable codes describing domain transition failures. */
export enum LifecycleTransitionErrorCode {
    INVALID_TRANSITION = 'INVALID_TRANSITION',
    TERMINAL_STATE = 'TERMINAL_STATE',
}

/** Domain error raised when a lifecycle transition is not permitted. */
export class LifecycleTransitionError extends Error {
    public constructor(
        public readonly code: LifecycleTransitionErrorCode,
        public readonly lifecycle: 'session' | 'question' | 'answer',
        public readonly currentStatus: string,
        public readonly requestedStatus: string,
    ) {
        super(`Cannot transition ${lifecycle} from ${currentStatus} to ${requestedStatus}.`);
        this.name = 'LifecycleTransitionError';
    }
}

const SESSION_TRANSITIONS: Readonly<Record<InterviewSessionStatus, ReadonlySet<InterviewSessionStatus>>> = {
    [InterviewSessionStatus.CREATED]: new Set([
        InterviewSessionStatus.INITIALIZING,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.INITIALIZING]: new Set([
        InterviewSessionStatus.READY,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.READY]: new Set([
        InterviewSessionStatus.RECORDING,
        InterviewSessionStatus.STOPPING,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.RECORDING]: new Set([
        InterviewSessionStatus.PROCESSING,
        InterviewSessionStatus.PAUSED,
        InterviewSessionStatus.STOPPING,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.PROCESSING]: new Set([
        InterviewSessionStatus.RECORDING,
        InterviewSessionStatus.PAUSED,
        InterviewSessionStatus.STOPPING,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.PAUSED]: new Set([
        InterviewSessionStatus.RECORDING,
        InterviewSessionStatus.STOPPING,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.STOPPING]: new Set([
        InterviewSessionStatus.COMPLETED,
        InterviewSessionStatus.FAILED,
    ]),
    [InterviewSessionStatus.COMPLETED]: new Set(),
    [InterviewSessionStatus.FAILED]: new Set(),
};

const QUESTION_TRANSITIONS: Readonly<Record<QuestionStatus, ReadonlySet<QuestionStatus>>> = {
    [QuestionStatus.DETECTED]: new Set([
        QuestionStatus.PROCESSING,
        QuestionStatus.FAILED,
        QuestionStatus.CANCELLED,
    ]),
    [QuestionStatus.PROCESSING]: new Set([
        QuestionStatus.ANSWERING,
        QuestionStatus.FAILED,
        QuestionStatus.CANCELLED,
    ]),
    [QuestionStatus.ANSWERING]: new Set([
        QuestionStatus.COMPLETED,
        QuestionStatus.FAILED,
        QuestionStatus.CANCELLED,
    ]),
    [QuestionStatus.COMPLETED]: new Set(),
    [QuestionStatus.FAILED]: new Set(),
    [QuestionStatus.CANCELLED]: new Set(),
};

const ANSWER_TRANSITIONS: Readonly<Record<AnswerStatus, ReadonlySet<AnswerStatus>>> = {
    [AnswerStatus.PENDING]: new Set([
        AnswerStatus.STREAMING,
        AnswerStatus.FAILED,
        AnswerStatus.CANCELLED,
    ]),
    [AnswerStatus.STREAMING]: new Set([
        AnswerStatus.COMPLETED,
        AnswerStatus.FAILED,
        AnswerStatus.CANCELLED,
    ]),
    [AnswerStatus.COMPLETED]: new Set(),
    [AnswerStatus.FAILED]: new Set(),
    [AnswerStatus.CANCELLED]: new Set(),
};

function transitionStatus<Status extends string>(
    lifecycle: 'session' | 'question' | 'answer',
    currentStatus: Status,
    requestedStatus: Status,
    transitions: Readonly<Record<Status, ReadonlySet<Status>>>,
): Status {
    const allowedStatuses = transitions[currentStatus];
    if (allowedStatuses.size === 0) {
        throw new LifecycleTransitionError(
            LifecycleTransitionErrorCode.TERMINAL_STATE,
            lifecycle,
            currentStatus,
            requestedStatus,
        );
    }
    if (!allowedStatuses.has(requestedStatus)) {
        throw new LifecycleTransitionError(
            LifecycleTransitionErrorCode.INVALID_TRANSITION,
            lifecycle,
            currentStatus,
            requestedStatus,
        );
    }
    return requestedStatus;
}

/** Guarded state machine for one interview session. */
export class InterviewSession {
    private currentStatus: InterviewSessionStatus;

    public constructor(
        public readonly sessionId: string,
        initialStatus: InterviewSessionStatus = InterviewSessionStatus.CREATED,
    ) {
        this.currentStatus = initialStatus;
    }

    /** Returns the current session status without mutating the session. */
    public get status(): InterviewSessionStatus {
        return this.currentStatus;
    }

    /** Moves the session to an allowed next status or rejects the transition. */
    public transitionTo(requestedStatus: InterviewSessionStatus): InterviewSessionStatus {
        this.currentStatus = transitionStatus(
            'session',
            this.currentStatus,
            requestedStatus,
            SESSION_TRANSITIONS,
        );
        return this.currentStatus;
    }
}

/** Guarded state machine for one detected interview question. */
export class InterviewQuestion {
    private currentStatus: QuestionStatus;

    public constructor(
        public readonly questionId: string,
        initialStatus: QuestionStatus = QuestionStatus.DETECTED,
    ) {
        this.currentStatus = initialStatus;
    }

    /** Returns the current question status without mutation. */
    public get status(): QuestionStatus {
        return this.currentStatus;
    }

    /** Moves the question to an allowed next status or rejects the transition. */
    public transitionTo(requestedStatus: QuestionStatus): QuestionStatus {
        this.currentStatus = transitionStatus(
            'question',
            this.currentStatus,
            requestedStatus,
            QUESTION_TRANSITIONS,
        );
        return this.currentStatus;
    }
}

/** Guarded state machine for one generated interview answer. */
export class InterviewAnswer {
    private currentStatus: AnswerStatus;

    public constructor(
        public readonly answerId: string,
        public readonly questionId: string,
        public readonly requestId: string,
        initialStatus: AnswerStatus = AnswerStatus.PENDING,
    ) {
        this.currentStatus = initialStatus;
    }

    /** Returns the current answer status without mutation. */
    public get status(): AnswerStatus {
        return this.currentStatus;
    }

    /** Moves the answer to an allowed next status or rejects the transition. */
    public transitionTo(requestedStatus: AnswerStatus): AnswerStatus {
        this.currentStatus = transitionStatus(
            'answer',
            this.currentStatus,
            requestedStatus,
            ANSWER_TRANSITIONS,
        );
        return this.currentStatus;
    }
}