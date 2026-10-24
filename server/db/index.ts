import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@shared/schema';

import { getServerConfig } from '../config/env';

const dataDirectory = getServerConfig().dataDirectory;
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, 'copilot.db');
const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/** Closes the process-owned SQLite connection during graceful shutdown. */
export function closeDatabase(): void {
    if (sqlite.open) {
        sqlite.close();
    }
}

export { sqlite };
