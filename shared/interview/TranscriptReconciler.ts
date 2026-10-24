import {
    RealtimeEventSequencer,
    RealtimeEventSequencerOptions,
    SequencerDisposition,
    SequencerResult,
} from './RealtimeEventSequencer';
import {
    RealtimeEvent,
    RealtimeEventType,
    Speaker,
} from './RealtimeProtocol';

/** Configuration for bounded, session-isolated transcript reconciliation. */
export interface TranscriptReconcilerOptions {
    readonly sessionId: string;
    readonly initialSequenceNumber?: number;
    readonly maxBufferedEvents?: number;
    readonly maxRememberedEvents?: number;
    readonly maxSequenceGap?: number;
    readonly maxRetainedSegments?: number;
}

/** Immutable current view of one stable transcript segment. */
export interface TranscriptSegmentSnapshot {
    readonly sessionId: string;
    readonly segmentId: string;
    readonly speaker: Speaker;
    readonly text: string;
    readonly isFinal: boolean;
    readonly sequenceNumber: number;
}

/** Reconciliation outcome and final-only snapshots eligible for persistence. */
export interface TranscriptReconciliationResult {
    readonly sequencing: SequencerResult;
    readonly currentSegments: ReadonlyArray<TranscriptSegmentSnapshot>;
    readonly finalizedSnapshots: ReadonlyArray<TranscriptSegmentSnapshot>;
}

const DEFAULT_MAX_RETAINED_SEGMENTS = 500;

type TranscriptEvent = Extract<
    RealtimeEvent,
    { type: RealtimeEventType.TRANSCRIPT_PARTIAL | RealtimeEventType.TRANSCRIPT_FINAL }
>;

function requireSegmentLimit(value: number): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError('maxRetainedSegments must be a positive integer.');
    }
    return value;
}

/** Reconciles ordered partial/final transcript events for exactly one session. */
export class TranscriptReconciler {
    private readonly sequencer: RealtimeEventSequencer;
    private readonly segments = new Map<string, TranscriptSegmentSnapshot>();
    private readonly finalizedSegmentIds = new Set<string>();
    private readonly finalizedSegmentIdOrder: string[] = [];
    private readonly maxRetainedSegments: number;

    public constructor(private readonly options: TranscriptReconcilerOptions) {
        const sequencerOptions: RealtimeEventSequencerOptions = {
            sessionId: options.sessionId,
            initialSequenceNumber: options.initialSequenceNumber,
            maxBufferedEvents: options.maxBufferedEvents,
            maxRememberedEvents: options.maxRememberedEvents,
            maxSequenceGap: options.maxSequenceGap,
        };
        this.sequencer = new RealtimeEventSequencer(sequencerOptions);
        this.maxRetainedSegments = requireSegmentLimit(
            options.maxRetainedSegments ?? DEFAULT_MAX_RETAINED_SEGMENTS,
        );
    }

    /** Sequences an event and applies all transcript events newly released in order. */
    public reconcile(event: RealtimeEvent): TranscriptReconciliationResult {
        const sequencing = this.sequencer.sequence(event);
        if (sequencing.disposition !== SequencerDisposition.RELEASED) {
            return this.createResult(sequencing, []);
        }

        const finalizedSnapshots: TranscriptSegmentSnapshot[] = [];
        for (const releasedEvent of sequencing.releasedEvents) {
            if (!this.isTranscriptEvent(releasedEvent)) {
                continue;
            }
            const finalizedSnapshot = this.applyTranscriptEvent(releasedEvent);
            if (finalizedSnapshot !== undefined) {
                finalizedSnapshots.push(finalizedSnapshot);
            }
        }
        return this.createResult(sequencing, finalizedSnapshots);
    }

    /** Returns retained partial and final segment snapshots in stable insertion order. */
    public getCurrentSegments(): ReadonlyArray<TranscriptSegmentSnapshot> {
        return Array.from(this.segments.values());
    }

    /** Returns only retained final snapshots, suitable for durable persistence. */
    public getPersistableFinalSnapshots(): ReadonlyArray<TranscriptSegmentSnapshot> {
        return this.getCurrentSegments().filter((segment) => segment.isFinal);
    }

    /** Returns the number of transcript segments retained in bounded memory. */
    public get retainedSegmentCount(): number {
        return this.segments.size;
    }

    private isTranscriptEvent(event: RealtimeEvent): event is TranscriptEvent {
        return event.type === RealtimeEventType.TRANSCRIPT_PARTIAL
            || event.type === RealtimeEventType.TRANSCRIPT_FINAL;
    }

    private applyTranscriptEvent(event: TranscriptEvent): TranscriptSegmentSnapshot | undefined {
        const existingSegment = this.segments.get(event.payload.segmentId);
        if (existingSegment?.isFinal === true || this.finalizedSegmentIds.has(event.payload.segmentId)) {
            return undefined;
        }

        const isFinal = event.type === RealtimeEventType.TRANSCRIPT_FINAL;
        if (
            !isFinal
            && existingSegment?.text === event.payload.text
            && existingSegment.speaker === event.payload.speaker
        ) {
            return undefined;
        }

        const snapshot: TranscriptSegmentSnapshot = {
            sessionId: event.sessionId,
            segmentId: event.payload.segmentId,
            speaker: event.payload.speaker,
            text: event.payload.text,
            isFinal,
            sequenceNumber: event.sequenceNumber,
        };
        this.segments.set(snapshot.segmentId, snapshot);
        if (isFinal) {
            this.rememberFinalizedSegment(snapshot.segmentId);
        }
        this.trimRetainedSegments();
        return isFinal ? snapshot : undefined;
    }

    private rememberFinalizedSegment(segmentId: string): void {
        this.finalizedSegmentIds.add(segmentId);
        this.finalizedSegmentIdOrder.push(segmentId);
        while (this.finalizedSegmentIdOrder.length > this.maxRetainedSegments) {
            const expiredSegmentId = this.finalizedSegmentIdOrder.shift();
            if (expiredSegmentId !== undefined) {
                this.finalizedSegmentIds.delete(expiredSegmentId);
            }
        }
    }

    private trimRetainedSegments(): void {
        while (this.segments.size > this.maxRetainedSegments) {
            const oldestSegmentId = this.segments.keys().next().value as string | undefined;
            if (oldestSegmentId === undefined) {
                return;
            }
            this.segments.delete(oldestSegmentId);
        }
    }

    private createResult(
        sequencing: SequencerResult,
        finalizedSnapshots: ReadonlyArray<TranscriptSegmentSnapshot>,
    ): TranscriptReconciliationResult {
        return {
            sequencing,
            currentSegments: this.getCurrentSegments(),
            finalizedSnapshots,
        };
    }
}