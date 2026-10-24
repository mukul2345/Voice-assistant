import { RealtimeEvent } from '../../shared/interview/RealtimeProtocol';

/** Provider-independent outbound channel for one interview session. */
export interface InterviewRealtimeTransport {
    /** Establishes the channel before events are sent. */
    connect(): Promise<void>;

    /** Sends one already validated domain protocol event. */
    send(event: RealtimeEvent): Promise<void>;

    /** Releases the channel and all resources it owns. */
    close(): Promise<void>;
}

/** Creates a transport scoped to exactly one interview session. */
export interface InterviewRealtimeTransportFactory {
    /** Creates an unconnected transport without choosing a wire technology in domain code. */
    create(sessionId: string): InterviewRealtimeTransport;
}
