import './load-env';

import fs from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';

import { getServerConfig, type ServerConfig } from './config/env';
import { closeDatabase } from './db';
import { runMigrations } from './db/migrate';
import { logger } from './logging/SafeLogger';
import { toSafeError } from './logging/SafeError';
import { registerRoutes } from './routes';
import { serveStatic } from './static';

declare module 'http' {
    interface IncomingMessage {
        rawBody: unknown;
    }
}

export interface ServerRuntime {
    readonly app: Express;
    readonly server: Server;
    readonly port: number;
    close(): Promise<void>;
}

const UPLOAD_MAX_AGE_MS = 5 * 60 * 1000;
const UPLOAD_CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) {
        return true;
    }
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
        return false;
    }
}

function getHttpStatus(error: unknown): number {
    if (typeof error !== 'object' || error === null) {
        return 500;
    }
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
}

function configureCoreMiddleware(app: Express): void {
    app.use(express.json({
        limit: '10mb',
        verify: (request, _response, buffer) => {
            request.rawBody = buffer;
        },
    }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cors({
        origin: (origin, callback) => {
            callback(isAllowedOrigin(origin) ? null : new Error('Origin is not allowed by CORS.'), isAllowedOrigin(origin));
        },
        credentials: true,
    }));
    app.use('/api/', rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } },
        standardHeaders: true,
        legacyHeaders: false,
    }));
    app.use((request, response, next) => {
        const startedAt = Date.now();
        response.on('finish', () => {
            if (!request.path.startsWith('/api') || (request.path === '/api/messages' && response.statusCode === 304)) {
                return;
            }
            logger.info('HTTP request completed.', {
                method: request.method,
                path: request.path,
                statusCode: response.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
        next();
    });
}

function startUploadJanitor(uploadsDirectory: string): NodeJS.Timeout {
    const interval = setInterval(() => {
        try {
            const expirationTime = Date.now() - UPLOAD_MAX_AGE_MS;
            for (const fileName of fs.readdirSync(uploadsDirectory)) {
                const filePath = path.join(uploadsDirectory, fileName);
                if (fs.statSync(filePath).mtimeMs < expirationTime) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (error) {
            logger.warn('Temporary upload janitor failed.', { error: toSafeError(error) });
        }
    }, UPLOAD_CLEANUP_INTERVAL_MS);
    interval.unref();
    return interval;
}

async function configureFrontend(app: Express, server: Server, config: ServerConfig): Promise<void> {
    if (config.nodeEnvironment === 'production') {
        serveStatic(app);
        return;
    }
    if (process.env.NODE_ENV === 'development') {
        const { setupVite } = await import('./vite');
        await setupVite(server, app);
    }
}

async function listen(server: Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = (): void => {
            server.off('error', onError);
            const address = server.address() as AddressInfo | null;
            if (!address) {
                reject(new Error('Server did not expose a listening address.'));
                return;
            }
            resolve(address.port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ port, host: '127.0.0.1' });
    });
}

/** Builds and starts the local HTTP server on exactly the configured port. */
export async function startServer(config: ServerConfig = getServerConfig()): Promise<ServerRuntime> {
    runMigrations();
    fs.mkdirSync(config.uploadsDirectory, { recursive: true });

    const app = express();
    const server = createServer(app);
    configureCoreMiddleware(app);
    app.get('/health', (_request, response) => {
        response.status(200).json({ status: 'ready' });
    });
    await registerRoutes(server, app);
    app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
        logger.error('Unhandled HTTP request failure.', {
            error: toSafeError(error),
            alert: true,
        });
        if (response.headersSent) {
            next(error);
            return;
        }
        response.status(getHttpStatus(error)).json({ message: 'Internal Server Error' });
    });
    await configureFrontend(app, server, config);

    const port = await listen(server, config.port);
    const uploadJanitor = startUploadJanitor(config.uploadsDirectory);
    let isClosed = false;

    return {
        app,
        server,
        port,
        async close(): Promise<void> {
            if (isClosed) {
                return;
            }
            isClosed = true;
            clearInterval(uploadJanitor);
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            closeDatabase();
        },
    };
}

function isDirectExecution(): boolean {
    const entryPoint = process.argv[1]?.replace(/\\/g, '/');
    return entryPoint?.endsWith('/server/index.ts') === true || entryPoint?.endsWith('/dist/index.cjs') === true;
}

async function runServerProcess(): Promise<void> {
    const runtime = await startServer();
    logger.info('Server is ready.', { port: runtime.port });
    process.stdout.write(`COPILOT_BACKEND_READY=${JSON.stringify({ port: runtime.port })}\n`);

    let isShuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;
        logger.info('Server shutdown started.', { signal });
        try {
            await runtime.close();
            process.exitCode = 0;
        } catch (error) {
            logger.error('Server shutdown failed.', { error: toSafeError(error), alert: true });
            process.exitCode = 1;
        }
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (isDirectExecution()) {
    void runServerProcess().catch((error) => {
        logger.error('Server startup failed.', { error: toSafeError(error), alert: true });
        process.exitCode = 1;
    });
}
