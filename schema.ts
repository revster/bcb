/**
 * schema.ts — Drizzle ORM table definitions for SQLite
 *
 * Dates are stored as ISO 8601 TEXT (compatible with the existing Prisma-created
 * schema). The custom `timestamp` type converts transparently between Date objects
 * and text strings, so callers always work with Date instances.
 */

import { sqliteTable, text, integer, real, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { customType } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

// ── Custom date type ──────────────────────────────────────────────────────────

// Stores Date objects as ISO 8601 text in SQLite. ISO strings sort correctly
// lexicographically, so lt/gt comparisons in WHERE clauses work as expected.
const timestamp = customType<{ data: Date; driverData: string }>({
  dataType() { return 'TEXT'; },
  fromDriver(value: string) { return new Date(value); },
  toDriver(value: Date) { return value.toISOString(); },
});

// ── Active models ─────────────────────────────────────────────────────────────

export const books = sqliteTable('Book', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  title:        text('title').notNull(),
  author:       text('author').notNull(),
  goodreadsUrl: text('goodreadsUrl').notNull(),
  image:        text('image'),
  pages:        integer('pages'),
  rating:       text('rating'),
  genres:       text('genres').notNull().default('[]'),
  createdAt:    timestamp('createdAt').notNull().$defaultFn(() => new Date()),
}, (t) => [
  unique('Book_goodreadsUrl_key').on(t.goodreadsUrl),
]);

export const memberChannels = sqliteTable('MemberChannel', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    text('userId').notNull(),
  username:  text('username').notNull(),
  channelId: text('channelId').notNull(),
  createdAt: timestamp('createdAt').notNull().$defaultFn(() => new Date()),
}, (t) => [
  unique('MemberChannel_userId_key').on(t.userId),
  unique('MemberChannel_channelId_key').on(t.channelId),
]);

export const readingLogs = sqliteTable('ReadingLog', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  userId:         text('userId').notNull(),
  bookId:         integer('bookId').notNull().references(() => books.id),
  threadId:       text('threadId'),
  status:         text('status').notNull().default('reading'),
  progress:       real('progress').notNull().default(0),
  rating:         real('rating'),
  startedAt:      timestamp('startedAt').notNull().$defaultFn(() => new Date()),
  finishedAt:     timestamp('finishedAt'),
  lastProgressAt: timestamp('lastProgressAt'),
  lastRemindedAt: timestamp('lastRemindedAt'),
  updatedAt:      timestamp('updatedAt').notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (t) => [
  unique('ReadingLog_threadId_key').on(t.threadId),
]);

export const users = sqliteTable('User', {
  userId:    text('userId').primaryKey(),
  username:  text('username').notNull(),
  updatedAt: timestamp('updatedAt').notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const settings = sqliteTable('Setting', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updatedAt').notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const reminderQuips = sqliteTable('ReminderQuip', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  text:      text('text').notNull(),
  createdAt: timestamp('createdAt').notNull().$defaultFn(() => new Date()),
});

export const clubBooks = sqliteTable('ClubBook', {
  id:                    integer('id').primaryKey({ autoIncrement: true }),
  bookId:                integer('bookId').notNull().references(() => books.id),
  progressMessageId:     text('progressMessageId'),
  progressBarsMessageId: text('progressBarsMessageId'),
  epilogueThreadId:      text('epilogueThreadId'),
  month:                 integer('month'),
  year:                  integer('year'),
  createdAt:             timestamp('createdAt').notNull().$defaultFn(() => new Date()),
}, (t) => [
  unique('ClubBook_bookId_unique').on(t.bookId),
]);

// ── Voting ────────────────────────────────────────────────────────────────────

export const polls = sqliteTable('Poll', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  month:     integer('month').notNull(),
  year:      integer('year').notNull(),
  open:      integer('open', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestamp('createdAt').notNull().$defaultFn(() => new Date()),
}, (t) => [
  unique('Poll_month_year_key').on(t.month, t.year),
]);

// TODO: once the nomination system is built, replace first/second/third (string keys)
// with integer foreign keys referencing Nomination.id (or Book.id directly).
export const votes = sqliteTable('Vote', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  pollId:    integer('pollId').notNull().references(() => polls.id),
  userId:    text('userId').notNull(),
  first:     text('first').notNull(),
  second:    text('second').notNull(),
  third:     text('third').notNull(),
  createdAt: timestamp('createdAt').notNull().$defaultFn(() => new Date()),
}, (t) => [
  unique('Vote_pollId_userId_key').on(t.pollId, t.userId),
]);

// ── Relations ─────────────────────────────────────────────────────────────────

export const booksRelations = relations(books, ({ many, one }) => ({
  readingLogs: many(readingLogs),
  clubBook:    one(clubBooks, { fields: [books.id], references: [clubBooks.bookId] }),
}));

export const readingLogsRelations = relations(readingLogs, ({ one }) => ({
  book: one(books, { fields: [readingLogs.bookId], references: [books.id] }),
}));

export const clubBooksRelations = relations(clubBooks, ({ one }) => ({
  book: one(books, { fields: [clubBooks.bookId], references: [books.id] }),
}));

export const pollsRelations = relations(polls, ({ many }) => ({
  votes: many(votes),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  poll: one(polls, { fields: [votes.pollId], references: [polls.id] }),
}));

// ── Inferred types (replaces @prisma/client imports) ─────────────────────────

export type Book = InferSelectModel<typeof books>;
export type ReadingLog = InferSelectModel<typeof readingLogs>;
export type ClubBook = InferSelectModel<typeof clubBooks>;
export type MemberChannel = InferSelectModel<typeof memberChannels>;
export type User = InferSelectModel<typeof users>;
export type Setting = InferSelectModel<typeof settings>;
export type ReminderQuip = InferSelectModel<typeof reminderQuips>;
export type Poll = InferSelectModel<typeof polls>;
export type Vote = InferSelectModel<typeof votes>;
export type LogWithBook = ReadingLog & { book: Book };
