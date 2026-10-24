import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ServerRuntime } from '../index';

/**
 * Cross-user HTTP ownership regression coverage. Runs the real server in-process
 * on an ephemeral port against an isolated temporary SQLite directory, exercising
 * the actual authentication, session, and message routes.
 */

interface RegisteredUser {
    readonly userId: number;
    readonly accessToken: string;
}

interface CreatedSession {
    readonly id: number;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-copilot-ownership-'));

let runtime: ServerRuntime;
let baseUrl: string;

async function registerUser(email: string): Promise<RegisteredUser> {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Sup3r-Secret-Passphrase!' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { id: number }; accessToken: string };
    return { userId: body.user.id, accessToken: body.accessToken };
}

async function createSession(owner: RegisteredUser, companyName: string): Promise<CreatedSession> {
    const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${owner.accessToken}`,
        },
        body: JSON.stringify({ companyName }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as CreatedSession;
}

function authorizedGet(pathname: string, user: RegisteredUser): Promise<Response> {
    return fetch(`${baseUrl}${pathname}`, {
        headers: { authorization: `Bearer ${user.accessToken}` },
    });
}

beforeAll(async () => {
    jest.setTimeout(30_000);
    process.env.NODE_ENV = 'test';
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'ownership-test-secret-that-is-at-least-thirty-two-characters';
    process.env.COPILOT_DATA_DIR = temporaryDirectory;

    const { parseServerConfig } = await import('../config/env');
    const { startServer } = await import('../index');
    runtime = await startServer(parseServerConfig(process.env));
    baseUrl = `http://127.0.0.1:${runtime.port}`;
});

afterAll(async () => {
    if (runtime !== undefined) {
        await runtime.close();
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('interview HTTP ownership boundary', () => {
    it('should deny cross-user access to sessions, messages, and updates without disclosure', async () => {
        const userA = await registerUser('owner-a@example.com');
        const userB = await registerUser('owner-b@example.com');
        const sessionA = await createSession(userA, 'Company A');
        const sessionB = await createSession(userB, 'Company B');

        expect(sessionA.id).not.toBe(sessionB.id);

        const ownSession = await authorizedGet(`/api/sessions/${sessionA.id}`, userA);
        expect(ownSession.status).toBe(200);

        const foreignSession = await authorizedGet(`/api/sessions/${sessionB.id}`, userA);
        expect(foreignSession.status).toBe(404);

        const foreignMessages = await authorizedGet(`/api/messages?sessionId=${sessionB.id}`, userA);
        expect(foreignMessages.status).toBe(404);

        const foreignUpdate = await fetch(`${baseUrl}/api/sessions/${sessionB.id}`, {
            method: 'PUT',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${userA.accessToken}`,
            },
            body: JSON.stringify({ companyName: 'Hijacked Company' }),
        });
        expect(foreignUpdate.status).toBe(404);

        const unchanged = await authorizedGet(`/api/sessions/${sessionB.id}`, userB);
        expect(unchanged.status).toBe(200);
        const unchangedBody = (await unchanged.json()) as { companyName: string };
        expect(unchangedBody.companyName).toBe('Company B');
    });
});
