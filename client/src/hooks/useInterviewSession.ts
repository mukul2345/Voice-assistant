import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import {
    InterviewAudioStatus,
    InterviewConnectionStatus,
    InterviewSessionSnapshot,
    InterviewSessionStore,
} from '../interview/InterviewSessionStore';

/**
 * React binding over the browser-safe {@link InterviewSessionStore}.
 *
 * The hook owns exactly one store per session id, subscribes React to bounded
 * snapshot changes, and exposes only pure ingestion and status setters. It does
 * not open transports, capture audio, or call providers; wiring those concerns
 * remains the responsibility of transport and capture layers outside Phase 3.
 */

export interface UseInterviewSessionResult {
    readonly snapshot: InterviewSessionSnapshot;
    ingest(untrustedEvent: unknown): void;
    setConnectionStatus(status: InterviewConnectionStatus): void;
    setAudioStatus(status: InterviewAudioStatus): void;
}

/** Subscribes a component to a single owner-scoped interview session store. */
export function useInterviewSession(sessionId: string): UseInterviewSessionResult {
    const storeRef = useRef<{ id: string; store: InterviewSessionStore } | null>(null);
    if (storeRef.current === null || storeRef.current.id !== sessionId) {
        storeRef.current = { id: sessionId, store: new InterviewSessionStore({ sessionId }) };
    }
    const store = storeRef.current.store;

    const subscribe = useMemo(
        () => (listener: () => void) => store.subscribe(() => listener()),
        [store],
    );

    const snapshot = useSyncExternalStore(
        subscribe,
        () => store.getSnapshot(),
        () => store.getSnapshot(),
    );

    const controls = useMemo<Omit<UseInterviewSessionResult, 'snapshot'>>(() => ({
        ingest: (untrustedEvent: unknown) => store.ingest(untrustedEvent),
        setConnectionStatus: (status: InterviewConnectionStatus) => store.setConnectionStatus(status),
        setAudioStatus: (status: InterviewAudioStatus) => store.setAudioStatus(status),
    }), [store]);

    useEffect(() => () => {
        // The store holds only bounded in-memory state; dropping the reference on
        // unmount or session change is sufficient cleanup.
        storeRef.current = null;
    }, [sessionId]);

    return { snapshot, ...controls };
}
