import { createRealtimeId, parseRealtimeEvent, RealtimeEventType } from '../../shared/interview/RealtimeProtocol';
import { TranscriptSegmentSnapshot } from '../../shared/interview/TranscriptReconciler';
import { InterviewAnswerPipeline } from './InterviewAnswerPipeline';
import {
    InterviewCoordinatorError,
    InterviewCoordinatorErrorCode,
    InterviewLifecycleLogger,
    InterviewLifecycleLogName,
    InterviewQuestionSnapshot,
} from './InterviewCoordinatorContracts';
import { InterviewSessionContext } from './InterviewSessionRegistry';

/** Owns transcript release forwarding and question detection from finalized segments. */
export class InterviewTranscriptPipeline {
    public constructor(
        private readonly answerPipeline: InterviewAnswerPipeline,
        private readonly lifecycleLogger: InterviewLifecycleLogger,
    ) {}

    public async ingest(
        sessionId: number,
        context: InterviewSessionContext,
        untrustedEvent: unknown,
    ): Promise<ReadonlyArray<TranscriptSegmentSnapshot>> {
        context.runtime.requireAcceptingEvents();
        const event = parseRealtimeEvent(untrustedEvent);
        if (event.sessionId !== String(sessionId)) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.SESSION_MISMATCH);
        }
        if (event.type !== RealtimeEventType.TRANSCRIPT_PARTIAL
            && event.type !== RealtimeEventType.TRANSCRIPT_FINAL) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.UNSUPPORTED_EVENT);
        }
        const reconciliation = context.runtime.reconcile(event);
        for (const releasedEvent of reconciliation.sequencing.releasedEvents) {
            await context.publisher.publishTranscript(releasedEvent);
            this.recordTranscriptMetric(sessionId, releasedEvent);
        }
        return reconciliation.finalizedSnapshots;
    }
    public async detectQuestion(
        sessionId: number,
        context: InterviewSessionContext,
        segmentId: string,
    ): Promise<InterviewQuestionSnapshot> {
        context.runtime.requireAcceptingEvents();
        const segment = context.runtime.findFinalSegment(segmentId);
        if (segment === undefined) {
            throw new InterviewCoordinatorError(InterviewCoordinatorErrorCode.FINAL_TRANSCRIPT_REQUIRED);
        }
        await this.answerPipeline.cancelActiveAnswer(
            sessionId,
            context.runtime,
            context.publisher,
            'SUPERSEDED',
        );
        const question = context.runtime.addQuestion(createRealtimeId(), segment);
        await context.publisher.publish((sequenceNumber) => ({
            type: RealtimeEventType.QUESTION_DETECTED,
            sessionId: String(sessionId),
            sequenceNumber,
            payload: {
                questionId: question.machine.questionId,
                segmentId,
                text: segment.text,
            },
        }));
        this.lifecycleLogger.info(InterviewLifecycleLogName.QUESTION_DETECTED, {
            sessionId,
            questionId: question.machine.questionId,
            segmentId,
            status: question.machine.status,
        });
        return {
            questionId: question.machine.questionId,
            segmentId: question.segmentId,
            status: question.machine.status,
        };
    }

    private recordTranscriptMetric(
        sessionId: number,
        event: Parameters<InterviewSessionContext['publisher']['publishTranscript']>[0],
    ): void {
        if (event.type === RealtimeEventType.TRANSCRIPT_PARTIAL) {
            this.lifecycleLogger.info(InterviewLifecycleLogName.TRANSCRIPT_PARTIAL_RECEIVED, {
                sessionId,
                segmentId: event.payload.segmentId,
            });
        } else if (event.type === RealtimeEventType.TRANSCRIPT_FINAL) {
            this.lifecycleLogger.info(InterviewLifecycleLogName.TRANSCRIPT_FINAL_RECEIVED, {
                sessionId,
                segmentId: event.payload.segmentId,
            });
        }
    }
}
