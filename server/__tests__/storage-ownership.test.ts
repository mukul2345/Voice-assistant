import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { Storage } from '../storage';

let closeDatabase: () => void;
let runMigrations: () => void;
let storage: Storage;
let temporaryDirectory: string;
let userAId: number;
let userBId: number;
let userASessionId: number;
let userBSessionId: number;

describe('storage ownership boundaries', () => {
    beforeAll(async () => {
        temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-copilot-storage-'));
        process.env.NODE_ENV = 'test';
        process.env.PORT = '0';
        process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
        process.env.COPILOT_DATA_DIR = temporaryDirectory;

        ({ closeDatabase } = await import('../db'));
        ({ runMigrations } = await import('../db/migrate'));
        ({ storage } = await import('../storage'));
        runMigrations();

        const userA = await storage.createUser({ email: 'user-a@example.test', passwordHash: 'hash-a' });
        const userB = await storage.createUser({ email: 'user-b@example.test', passwordHash: 'hash-b' });
        userAId = userA.id;
        userBId = userB.id;
        userASessionId = (await storage.createSession({ userId: userAId, companyName: 'A' })).id;
        userBSessionId = (await storage.createSession({ userId: userBId, companyName: 'B' })).id;
        await storage.createMessage(userAId, {
            sessionId: userASessionId,
            transcription: 'Question for A',
            aiResponse: 'Answer for A',
        });
        await storage.createMessage(userBId, {
            sessionId: userBSessionId,
            transcription: 'Question for B',
            aiResponse: 'Confidential answer for B',
        });
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });
    it('should prevent User A from reading User B messages and answers', async () => {
        const userAMessages = await storage.getMessages(userAId);
        const crossSessionMessages = await storage.getMessages(userAId, userBSessionId);

        expect(userAMessages).toHaveLength(1);
        expect(userAMessages[0].aiResponse).toBe('Answer for A');
        expect(userAMessages.map((message) => message.aiResponse)).not.toContain('Confidential answer for B');
        expect(crossSessionMessages).toEqual([]);
    });

    it('should prevent User A from mutating User B session', async () => {
        const updatedSession = await storage.updateSessionForUser(userBSessionId, userAId, {
            companyName: 'Unauthorized update',
        });
        const userBSession = await storage.getSessionForUser(userBSessionId, userBId);

        expect(updatedSession).toBeUndefined();
        expect(userBSession?.companyName).toBe('B');
    });

    it('should prevent User A from writing a message into User B session', async () => {
        await expect(storage.createMessage(userAId, {
            sessionId: userBSessionId,
            transcription: 'Cross-tenant question',
            aiResponse: 'Cross-tenant answer',
        })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' });
    });
});
