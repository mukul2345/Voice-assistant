import { describe, expect, it } from '@jest/globals';

import { SequencerDisposition } from '../../shared/interview/RealtimeEventSequencer';
import {
    createRealtimeEvent,
    createRealtimeId,
    RealtimeEvent,
    RealtimeEventType,
    Speaker,
} from '../../shared/interview/RealtimeProtocol';
import { TranscriptReconciler } from '../../shared/interview/TranscriptReconciler';

const SESSION_ID = createRealtimeId();

function createTranscriptEvent({
    sequenceNumber,
    segmentId,
    text,
    type = RealtimeEventType.TRANSCRIPT_PARTIAL,
    sessionId = SESSION_ID,
}: {
    sequenceNumber: number;
    segmentId: string;
    text: string;
    type?: RealtimeEventType.TRANSCRIPT_PARTIAL | RealtimeEventType.TRANSCRIPT_FINAL;
    sessionId?: string;
}): RealtimeEvent {
    if (type === RealtimeEventType.TRANSCRIPT_FINAL) {
        return createRealtimeEvent({
            type,
            sessionId,
            sequenceNumber,
            payload: { segmentId, speaker: Speaker.INTERVIEWER, text },
        });
    }
    return createRealtimeEvent({
        type,
        sessionId,
        sequenceNumber,
        payload: { segmentId, speaker: Speaker.INTERVIEWER, text },
    });
}

describe('TranscriptReconciler', () => {
    it('should replace partials by stable segment ID and expose only finals for persistence', () => {
        const segmentId = createRealtimeId();
        const reconciler = new TranscriptReconciler({ sessionId: SESSION_ID });

        const firstResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 1,
            segmentId,
            text: 'partial',
        }));
        const replacementResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 2,
            segmentId,
            text: 'replacement partial',
        }));

        expect(firstResult.finalizedSnapshots).toEqual([]);
        expect(replacementResult.currentSegments).toEqual([
            expect.objectContaining({ segmentId, text: 'replacement partial', isFinal: false }),
        ]);
        expect(reconciler.getPersistableFinalSnapshots()).toEqual([]);
    });

    it('should finalize once and prevent a late partial from overwriting final text', () => {
        const segmentId = createRealtimeId();
        const reconciler = new TranscriptReconciler({ sessionId: SESSION_ID });
        reconciler.reconcile(createTranscriptEvent({ sequenceNumber: 1, segmentId, text: 'part' }));
        const finalEvent = createTranscriptEvent({
            sequenceNumber: 2,
            segmentId,
            text: 'authoritative final',
            type: RealtimeEventType.TRANSCRIPT_FINAL,
        });

        const finalResult = reconciler.reconcile(finalEvent);
        const duplicateResult = reconciler.reconcile(finalEvent);
        const latePartialResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 3,
            segmentId,
            text: 'late partial',
        }));

        expect(finalResult.finalizedSnapshots).toEqual([
            expect.objectContaining({ text: 'authoritative final', isFinal: true }),
        ]);
        expect(duplicateResult.sequencing.disposition).toBe(SequencerDisposition.DUPLICATE);
        expect(latePartialResult.finalizedSnapshots).toEqual([]);
        expect(reconciler.getCurrentSegments()).toEqual([
            expect.objectContaining({ text: 'authoritative final', isFinal: true }),
        ]);
        expect(reconciler.getPersistableFinalSnapshots()).toHaveLength(1);
    });

    it('should buffer missing events and reconcile released events in sequence order', () => {
        const segmentId = createRealtimeId();
        const reconciler = new TranscriptReconciler({
            sessionId: SESSION_ID,
            initialSequenceNumber: 100,
        });
        reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 101,
            segmentId,
            text: 'first partial',
        }));
        const missingResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 103,
            segmentId,
            text: 'final',
            type: RealtimeEventType.TRANSCRIPT_FINAL,
        }));
        const releasedResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 102,
            segmentId,
            text: 'second partial',
        }));

        expect(missingResult.sequencing.disposition).toBe(SequencerDisposition.BUFFERED);
        expect(missingResult.sequencing.missingSequenceNumbers).toEqual([102]);
        expect(releasedResult.sequencing.releasedEvents.map(({ sequenceNumber }) => sequenceNumber))
            .toEqual([102, 103]);
        expect(releasedResult.finalizedSnapshots[0]).toEqual(
            expect.objectContaining({ text: 'final', sequenceNumber: 103 }),
        );
    });

    it('should reject cross-session events without contaminating either session', () => {
        const otherSessionId = createRealtimeId();
        const segmentId = createRealtimeId();
        const firstReconciler = new TranscriptReconciler({ sessionId: SESSION_ID });
        const secondReconciler = new TranscriptReconciler({ sessionId: otherSessionId });
        const otherSessionEvent = createTranscriptEvent({
            sequenceNumber: 1,
            segmentId,
            text: 'other session',
            sessionId: otherSessionId,
        });

        const rejectedResult = firstReconciler.reconcile(otherSessionEvent);
        const acceptedResult = secondReconciler.reconcile(otherSessionEvent);

        expect(rejectedResult.sequencing.disposition).toBe(
            SequencerDisposition.REJECTED_SESSION,
        );
        expect(firstReconciler.getCurrentSegments()).toEqual([]);
        expect(acceptedResult.currentSegments).toHaveLength(1);
    });

    it('should bound retained segments and ignore duplicate partial content', () => {
        const reconciler = new TranscriptReconciler({
            sessionId: SESSION_ID,
            maxRetainedSegments: 2,
        });
        const firstSegmentId = createRealtimeId();
        const secondSegmentId = createRealtimeId();
        const thirdSegmentId = createRealtimeId();
        reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 1,
            segmentId: firstSegmentId,
            text: 'first',
        }));
        const duplicateContentResult = reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 2,
            segmentId: firstSegmentId,
            text: 'first',
        }));
        reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 3,
            segmentId: secondSegmentId,
            text: 'second',
        }));
        reconciler.reconcile(createTranscriptEvent({
            sequenceNumber: 4,
            segmentId: thirdSegmentId,
            text: 'third',
        }));

        expect(duplicateContentResult.currentSegments[0]?.sequenceNumber).toBe(1);
        expect(reconciler.retainedSegmentCount).toBe(2);
        expect(reconciler.getCurrentSegments().map(({ segmentId }) => segmentId)).toEqual([
            secondSegmentId,
            thirdSegmentId,
        ]);
    });
});