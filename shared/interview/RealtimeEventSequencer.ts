import { RealtimeEvent } from './RealtimeProtocol';

/** Classification assigned to a submitted realtime event. */
export enum SequencerDisposition {
    RELEASED = 'RELEASED',
    BUFFERED = 'BUFFERED',
    DUPLICATE = 'DUPLICATE',
    STALE = 'STALE',
    REJECTED_SESSION = 'REJECTED_SESSION',
    REJECTED_GAP = 'REJECTED_GAP',
    REJECTED_CAPACITY = 'REJECTED_CAPACITY',
}

/** Bounded-memory configuration for a realtime event sequencer. */
export interface RealtimeEventSequencerOptions {
    readonly sessionId: string;
    readonly initialSequenceNumber?: number;
    readonly maxBufferedEvents?: number;
    readonly maxRememberedEvents?: number;
    readonly maxSequenceGap?: number;
}

/** Outcome of one event submission, including any newly contiguous events. */
export interface SequencerResult {
    readonly disposition: SequencerDisposition;
    readonly releasedEvents: ReadonlyArray<RealtimeEvent>;
    readonly missingSequenceNumbers: ReadonlyArray<number>;
}

const DEFAULT_MAX_BUFFERED_EVENTS = 128;
const DEFAULT_MAX_REMEMBERED_EVENTS = 1024;
const DEFAULT_MAX_SEQUENCE_GAP = 128;

function requirePositiveInteger(value: number, optionName: string): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${optionName} must be a positive integer.`);
    }
    return value;
}

/** Orders one session's events and bounds duplicate and gap tracking memory. */
export class RealtimeEventSequencer {
    private readonly bufferedEvents = new Map<number, RealtimeEvent>();
    private readonly recentEventIds = new Set<string>();
    private readonly recentEventIdOrder: string[] = [];
    private readonly recentSequenceNumbers = new Set<number>();
    private readonly recentSequenceNumberOrder: number[] = [];
    private readonly maxBufferedEvents: number;
    private readonly maxRememberedEvents: number;
    private readonly maxSequenceGap: number;
    private nextSequenceNumber: number;

    public constructor(private readonly options: RealtimeEventSequencerOptions) {
        const initialSequenceNumber = options.initialSequenceNumber ?? 0;
        if (!Number.isInteger(initialSequenceNumber) || initialSequenceNumber < 0) {
            throw new RangeError('initialSequenceNumber must be a non-negative integer.');
        }
        this.nextSequenceNumber = initialSequenceNumber + 1;
        this.maxBufferedEvents = requirePositiveInteger(
            options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS,
            'maxBufferedEvents',
        );
        this.maxRememberedEvents = requirePositiveInteger(
            options.maxRememberedEvents ?? DEFAULT_MAX_REMEMBERED_EVENTS,
            'maxRememberedEvents',
        );
        this.maxSequenceGap = requirePositiveInteger(
            options.maxSequenceGap ?? DEFAULT_MAX_SEQUENCE_GAP,
            'maxSequenceGap',
        );
    }

    /** Returns the sequence number required to release the next event. */
    public get nextExpectedSequenceNumber(): number {
        return this.nextSequenceNumber;
    }

    /** Returns the number of currently buffered out-of-order events. */
    public get bufferedEventCount(): number {
        return this.bufferedEvents.size;
    }

    /** Returns the bounded number of released event identities retained for deduplication. */
    public get rememberedEventCount(): number {
        return this.recentEventIds.size;
    }

    /** Submits one event and iteratively releases every newly contiguous event. */
    public sequence(event: RealtimeEvent): SequencerResult {
        if (event.sessionId !== this.options.sessionId) {
            return this.createResult(SequencerDisposition.REJECTED_SESSION);
        }
        if (this.isDuplicateEvent(event)) {
            return this.createResult(SequencerDisposition.DUPLICATE);
        }
        if (event.sequenceNumber < this.nextSequenceNumber) {
            return this.createResult(SequencerDisposition.STALE);
        }
        if (event.sequenceNumber > this.nextSequenceNumber) {
            return this.bufferFutureEvent(event);
        }
        return this.releaseContiguousEvents(event);
    }

    private isDuplicateEvent(event: RealtimeEvent): boolean {
        if (this.recentEventIds.has(event.eventId)) {
            return true;
        }
        if (this.recentSequenceNumbers.has(event.sequenceNumber)) {
            return true;
        }
        if (this.bufferedEvents.has(event.sequenceNumber)) {
            return true;
        }
        return Array.from(this.bufferedEvents.values()).some(
            (bufferedEvent) => bufferedEvent.eventId === event.eventId,
        );
    }

    private bufferFutureEvent(event: RealtimeEvent): SequencerResult {
        const sequenceGap = event.sequenceNumber - this.nextSequenceNumber;
        if (sequenceGap > this.maxSequenceGap) {
            return this.createResult(SequencerDisposition.REJECTED_GAP);
        }
        if (this.bufferedEvents.size >= this.maxBufferedEvents) {
            return this.createResult(SequencerDisposition.REJECTED_CAPACITY);
        }
        this.bufferedEvents.set(event.sequenceNumber, event);
        return {
            disposition: SequencerDisposition.BUFFERED,
            releasedEvents: [],
            missingSequenceNumbers: this.collectMissingSequenceNumbers(event.sequenceNumber),
        };
    }

    private releaseContiguousEvents(firstEvent: RealtimeEvent): SequencerResult {
        const releasedEvents: RealtimeEvent[] = [];
        let eventToRelease: RealtimeEvent | undefined = firstEvent;
        while (eventToRelease !== undefined) {
            releasedEvents.push(eventToRelease);
            this.rememberReleasedEvent(eventToRelease);
            this.bufferedEvents.delete(eventToRelease.sequenceNumber);
            this.nextSequenceNumber += 1;
            eventToRelease = this.bufferedEvents.get(this.nextSequenceNumber);
        }
        return {
            disposition: SequencerDisposition.RELEASED,
            releasedEvents,
            missingSequenceNumbers: [],
        };
    }

    private collectMissingSequenceNumbers(highestSequenceNumber: number): number[] {
        const missingSequenceNumbers: number[] = [];
        for (
            let sequenceNumber = this.nextSequenceNumber;
            sequenceNumber < highestSequenceNumber;
            sequenceNumber += 1
        ) {
            if (!this.bufferedEvents.has(sequenceNumber)) {
                missingSequenceNumbers.push(sequenceNumber);
            }
        }
        return missingSequenceNumbers;
    }

    private rememberReleasedEvent(event: RealtimeEvent): void {
        this.recentEventIds.add(event.eventId);
        this.recentEventIdOrder.push(event.eventId);
        this.recentSequenceNumbers.add(event.sequenceNumber);
        this.recentSequenceNumberOrder.push(event.sequenceNumber);
        this.trimRememberedEvents();
    }

    private trimRememberedEvents(): void {
        while (this.recentEventIdOrder.length > this.maxRememberedEvents) {
            const expiredEventId = this.recentEventIdOrder.shift();
            if (expiredEventId !== undefined) {
                this.recentEventIds.delete(expiredEventId);
            }
        }
        while (this.recentSequenceNumberOrder.length > this.maxRememberedEvents) {
            const expiredSequenceNumber = this.recentSequenceNumberOrder.shift();
            if (expiredSequenceNumber !== undefined) {
                this.recentSequenceNumbers.delete(expiredSequenceNumber);
            }
        }
    }

    private createResult(disposition: SequencerDisposition): SequencerResult {
        return {
            disposition,
            releasedEvents: [],
            missingSequenceNumbers: [],
        };
    }
}