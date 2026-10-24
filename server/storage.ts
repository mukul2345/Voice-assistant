import { and, desc, eq } from 'drizzle-orm';

import {
    messages,
    refreshTokens,
    sessions,
    subscriptions,
    trialUsage,
    users,
    type InsertMessage,
    type InsertSession,
    type InsertUser,
    type Message,
    type RefreshToken,
    type Session,
    type Subscription,
    type TrialUsage,
    type User,
} from '@shared/schema';

import { db } from './db';

export type OwnedMessageInput = Omit<InsertMessage, 'userId'>;
export type SessionUpdates = Partial<Omit<Session, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;
export type SubscriptionUpdates = Partial<Omit<Subscription, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export enum StorageErrorCode {
    SESSION_NOT_OWNED = 'SESSION_NOT_OWNED',
}

/** Indicates that a caller attempted to cross an ownership boundary. */
export class StorageOwnershipError extends Error {
    public readonly code: StorageErrorCode;

    public constructor(code: StorageErrorCode) {
        super('The requested resource is unavailable.');
        this.code = code;
        this.name = 'StorageOwnershipError';
    }
}

/** Tenant-scoped persistence contract for Interview Copilot. */
export interface Storage {
    getMessages(userId: number, sessionId?: number): Promise<Message[]>;
    createMessage(userId: number, message: OwnedMessageInput): Promise<Message>;
    clearMessages(userId: number): Promise<void>;
    getUserByEmail(email: string): Promise<User | undefined>;
    getUserById(id: number): Promise<User | undefined>;
    createUser(user: InsertUser): Promise<User>;
    createRefreshToken(userId: number, token: string, expiresAt: string): Promise<RefreshToken>;
    getRefreshToken(token: string): Promise<RefreshToken | undefined>;
    revokeRefreshToken(userId: number, token: string): Promise<boolean>;
    revokeAllUserTokens(userId: number): Promise<void>;
    getTrialUsage(userId: number): Promise<TrialUsage | undefined>;
    createTrialUsage(userId: number): Promise<TrialUsage>;
    incrementTrialUsage(userId: number, seconds: number): Promise<void>;
    getSubscription(userId: number): Promise<Subscription | undefined>;
    upsertSubscription(userId: number, updates: SubscriptionUpdates): Promise<void>;
    getSessions(userId: number): Promise<Session[]>;
    getSessionForUser(sessionId: number, userId: number): Promise<Session | undefined>;
    createSession(session: InsertSession): Promise<Session>;
    updateSessionForUser(sessionId: number, userId: number, updates: SessionUpdates): Promise<Session | undefined>;
}

class DrizzleStorage implements Storage {
    public async getMessages(userId: number, sessionId?: number): Promise<Message[]> {
        if (sessionId !== undefined) {
            return db
                .select()
                .from(messages)
                .where(and(eq(messages.userId, userId), eq(messages.sessionId, sessionId)))
                .orderBy(messages.id);
        }
        return db.select().from(messages).where(eq(messages.userId, userId)).orderBy(messages.id);
    }

    public async createMessage(userId: number, message: OwnedMessageInput): Promise<Message> {
        if (message.sessionId !== undefined && message.sessionId !== null) {
            const ownedSession = await this.getSessionForUser(message.sessionId, userId);
            if (!ownedSession) {
                throw new StorageOwnershipError(StorageErrorCode.SESSION_NOT_OWNED);
            }
        }

        return db
            .insert(messages)
            .values({ ...message, userId })
            .returning()
            .get();
    }

    public async clearMessages(userId: number): Promise<void> {
        db.delete(messages).where(eq(messages.userId, userId)).run();
    }

    public async getUserByEmail(email: string): Promise<User | undefined> {
        return db.select().from(users).where(eq(users.email, email)).get();
    }

    public async getUserById(id: number): Promise<User | undefined> {
        return db.select().from(users).where(eq(users.id, id)).get();
    }

    public async createUser(user: InsertUser): Promise<User> {
        return db.insert(users).values(user).returning().get();
    }

    public async createRefreshToken(userId: number, token: string, expiresAt: string): Promise<RefreshToken> {
        return db.insert(refreshTokens).values({ userId, token, expiresAt }).returning().get();
    }

    public async getRefreshToken(token: string): Promise<RefreshToken | undefined> {
        return db.select().from(refreshTokens).where(eq(refreshTokens.token, token)).get();
    }

    public async revokeRefreshToken(userId: number, token: string): Promise<boolean> {
        const update = db
            .update(refreshTokens)
            .set({ revoked: true })
            .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.token, token)))
            .run();
        return update.changes > 0;
    }

    public async revokeAllUserTokens(userId: number): Promise<void> {
        db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId)).run();
    }

    public async getTrialUsage(userId: number): Promise<TrialUsage | undefined> {
        return db.select().from(trialUsage).where(eq(trialUsage.userId, userId)).get();
    }

    public async createTrialUsage(userId: number): Promise<TrialUsage> {
        return db
            .insert(trialUsage)
            .values({ userId, usedSeconds: 0, totalAllowedSeconds: 3600 })
            .returning()
            .get();
    }

    public async incrementTrialUsage(userId: number, seconds: number): Promise<void> {
        const currentUsage = await this.getTrialUsage(userId);
        if (!currentUsage) {
            return;
        }
        db.update(trialUsage)
            .set({
                usedSeconds: (currentUsage.usedSeconds ?? 0) + seconds,
                lastUpdated: new Date().toISOString(),
            })
            .where(eq(trialUsage.userId, userId))
            .run();
    }

    public async getSubscription(userId: number): Promise<Subscription | undefined> {
        return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
    }

    public async upsertSubscription(userId: number, updates: SubscriptionUpdates): Promise<void> {
        const existingSubscription = await this.getSubscription(userId);
        if (existingSubscription) {
            db.update(subscriptions)
                .set({ ...updates, updatedAt: new Date().toISOString() })
                .where(eq(subscriptions.userId, userId))
                .run();
            return;
        }
        db.insert(subscriptions).values({ userId, status: 'inactive', ...updates }).run();
    }

    public async getSessions(userId: number): Promise<Session[]> {
        return db
            .select()
            .from(sessions)
            .where(eq(sessions.userId, userId))
            .orderBy(desc(sessions.updatedAt));
    }

    public async getSessionForUser(sessionId: number, userId: number): Promise<Session | undefined> {
        return db
            .select()
            .from(sessions)
            .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
            .get();
    }

    public async createSession(session: InsertSession): Promise<Session> {
        return db.insert(sessions).values(session).returning().get();
    }

    public async updateSessionForUser(
        sessionId: number,
        userId: number,
        updates: SessionUpdates,
    ): Promise<Session | undefined> {
        const update = db
            .update(sessions)
            .set({ ...updates, updatedAt: new Date().toISOString() })
            .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
            .run();
        if (update.changes === 0) {
            return undefined;
        }
        return this.getSessionForUser(sessionId, userId);
    }
}

export const storage: Storage = new DrizzleStorage();
