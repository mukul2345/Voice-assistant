import { describe, expect, it, jest } from '@jest/globals';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function waitForReadiness(child: ChildProcessWithoutNullStreams): Promise<number> {
    return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Server readiness timed out.')), 15_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            output += chunk;
            const match = output.match(/COPILOT_BACKEND_READY=({[^\n]+})/);
            if (!match) {
                return;
            }
            clearTimeout(timeout);
            const readiness = JSON.parse(match[1]) as { port: number };
            resolve(readiness.port);
        });
        child.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('exit', (code) => {
            if (!output.includes('COPILOT_BACKEND_READY=')) {
                clearTimeout(timeout);
                reject(new Error(`Server exited before readiness with code ${code ?? 'unknown'}.`));
            }
        });
    });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
    return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

describe('server lifecycle', () => {
    jest.setTimeout(25_000);

    it('should report readiness, serve health, and stop cleanly', async () => {
        const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-copilot-startup-'));
        const tsxExecutable = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
        const child = spawn(tsxExecutable, ['server/index.ts'], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                PORT: '0',
                JWT_SECRET: 'startup-test-secret-that-is-at-least-thirty-two-characters',
                COPILOT_DATA_DIR: temporaryDirectory,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stderr.resume();

        try {
            const port = await waitForReadiness(child);
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ status: 'ready' });

            child.kill('SIGTERM');
            await expect(waitForExit(child)).resolves.toBe(0);
        } finally {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    });
});
