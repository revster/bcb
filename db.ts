import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dbPath = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '');
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

export = db;
