/**
 * website/lib/clubStats.ts
 *
 * Stat-computation functions for club-wide pages:
 *   - leaderboard  (all members ranked by BOTM completions)
 *   - club overview (aggregate stats across the whole club)
 *   - book detail   (per-member status for a single book)
 */

import { eq, asc, desc } from 'drizzle-orm';
import db = require('../../db');
import { books, readingLogs, clubBooks, users, memberChannels } from '../../schema';
import type { Book, LogWithBook } from '../../schema';

// ── Shared helpers ────────────────────────────────────────────────────────────

function resolveNames(userIds: string[]): Map<string, string> {
  if (!userIds.length) return new Map();
  const map = new Map<string, string>();
  for (const m of db.select({ userId: memberChannels.userId, username: memberChannels.username }).from(memberChannels).all())
    map.set(m.userId, m.username);
  for (const u of db.select({ userId: users.userId, username: users.username }).from(users).all())
    map.set(u.userId, u.username); // User table wins
  return map;
}

function deduplicateByBook(logs: LogWithBook[]): LogWithBook[] {
  const groups = new Map<number, { log: LogWithBook; statuses: string[] }>();
  for (const log of logs) {
    const g = groups.get(log.bookId);
    if (!g) groups.set(log.bookId, { log, statuses: [log.status] });
    else   { g.log = log; g.statuses.push(log.status); }
  }
  return [...groups.values()].map(({ log, statuses }) => ({
    ...log,
    status: statuses.includes('finished')  ? 'finished'
           : statuses.includes('reading')   ? 'reading'
           : statuses.includes('abandoned') ? 'abandoned'
           : 'dnr',
  }));
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface LeaderboardRow {
  userId:      string;
  displayName: string;
  finished:    number;
  enrolled:    number;
  rate:        number; // 0–100 integer
  avgRating:   number | null;
}

export interface LeaderboardData {
  rows:  LeaderboardRow[];
  years: number[]; // distinct BOTM years available for the year filter
}

export async function computeLeaderboard(filterYear?: number): Promise<LeaderboardData> {
  const allLogs = (await db.query.readingLogs.findMany({
    with: { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];

  const clubBookRows = db
    .select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
    .from(clubBooks)
    .orderBy(asc(clubBooks.year), asc(clubBooks.month))
    .all();

  const botmBookIds = new Set(
    clubBookRows.filter(cb => cb.month !== null && cb.year !== null).map(cb => cb.bookId),
  );
  const clubBookYearMap = new Map(clubBookRows.map(cb => [cb.bookId, cb.year]));

  const years = [...new Set(
    clubBookRows.filter(cb => cb.year !== null).map(cb => cb.year!)
  )].sort((a, b) => b - a);

  // Group logs by userId, deduplicate per book
  const byUser = new Map<string, LogWithBook[]>();
  for (const log of allLogs) {
    if (!byUser.has(log.userId)) byUser.set(log.userId, []);
    byUser.get(log.userId)!.push(log);
  }

  const nameMap = resolveNames([...byUser.keys()]);

  const rows: LeaderboardRow[] = [];
  for (const [userId, userLogs] of byUser) {
    const deduped  = deduplicateByBook(userLogs);
    // Apply year filter if requested
    const clubLogs = deduped.filter(l =>
      botmBookIds.has(l.bookId) &&
      (!filterYear || clubBookYearMap.get(l.bookId) === filterYear)
    );
    if (!clubLogs.length) continue;

    const finished = clubLogs.filter(l => l.status === 'finished');
    const rated    = clubLogs.filter(l => l.rating !== null) as Array<LogWithBook & { rating: number }>;
    const avgRating = rated.length
      ? rated.reduce((s, l) => s + l.rating, 0) / rated.length
      : null;

    rows.push({
      userId,
      displayName: nameMap.get(userId) ?? userId,
      finished:    finished.length,
      enrolled:    clubLogs.length,
      rate:        Math.round((finished.length / clubLogs.length) * 100),
      avgRating,
    });
  }

  rows.sort((a, b) => b.finished - a.finished || a.displayName.localeCompare(b.displayName));

  return { rows, years };
}

// ── Club overview ─────────────────────────────────────────────────────────────

export interface BotmYearSummary {
  year:        number;
  books:       number;
  avgEnrolled: number;
  avgRate:     number;
  avgRating:   number | null;
}

export interface MostReadBook {
  book:      Book;
  finishers: number;
  avgRating: number | null;
}

export interface CurrentlyReadingEntry {
  userId:      string;
  displayName: string;
  book:        Book;
  progress:    number;
}

export interface ClubOverview {
  totalFinished:        number;
  uniqueBooksRead:      number;
  activeMembers:        number;
  currentlyReadingCount: number;
  botmByYear:           BotmYearSummary[];
  mostReadBooks:        MostReadBook[];
  topGenres:            Array<{ genre: string; count: number }>;
  currentlyReading:     CurrentlyReadingEntry[];
}

export async function computeClubOverview(): Promise<ClubOverview> {
  const allLogs = (await db.query.readingLogs.findMany({
    with: { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];

  const clubBookRows = db
    .select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
    .from(clubBooks)
    .all();

  const botmBookYearMap = new Map(
    clubBookRows.filter(cb => cb.month !== null && cb.year !== null)
      .map(cb => [cb.bookId, cb.year!]),
  );

  // Deduplicate per user+book
  const byUser = new Map<string, LogWithBook[]>();
  for (const log of allLogs) {
    if (!byUser.has(log.userId)) byUser.set(log.userId, []);
    byUser.get(log.userId)!.push(log);
  }

  const allDeduped: LogWithBook[] = [];
  for (const userLogs of byUser.values()) {
    allDeduped.push(...deduplicateByBook(userLogs));
  }

  const allFinished  = allDeduped.filter(l => l.status === 'finished');
  const allReading   = allDeduped.filter(l => l.status === 'reading');
  const uniqueBookIds = new Set(allFinished.map(l => l.bookId));

  // BOTM by year
  const botmLogs = allDeduped.filter(l => botmBookYearMap.has(l.bookId));
  const botmByYearMap = new Map<number, LogWithBook[]>();
  for (const log of botmLogs) {
    const year = botmBookYearMap.get(log.bookId)!;
    if (!botmByYearMap.has(year)) botmByYearMap.set(year, []);
    botmByYearMap.get(year)!.push(log);
  }

  // Per-year: group by bookId to compute enrolled/finished per book, then avg
  const botmByYear: BotmYearSummary[] = [...botmByYearMap.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, logs]) => {
      const byBook = new Map<number, LogWithBook[]>();
      for (const l of logs) {
        if (!byBook.has(l.bookId)) byBook.set(l.bookId, []);
        byBook.get(l.bookId)!.push(l);
      }
      const bookStats = [...byBook.values()].map(bl => ({
        enrolled: bl.length,
        finished: bl.filter(l => l.status === 'finished').length,
      }));
      const avgEnrolled = bookStats.reduce((s, b) => s + b.enrolled, 0) / bookStats.length;
      const avgRate     = bookStats.reduce((s, b) => s + (b.finished / b.enrolled) * 100, 0) / bookStats.length;
      const rated       = logs.filter(l => l.rating !== null) as Array<LogWithBook & { rating: number }>;
      const avgRating   = rated.length ? rated.reduce((s, l) => s + l.rating, 0) / rated.length : null;
      return { year, books: byBook.size, avgEnrolled: Math.round(avgEnrolled), avgRate: Math.round(avgRate), avgRating };
    });

  // Most-read books (3+ finishers)
  const finishedByBook = new Map<number, { book: Book; logs: LogWithBook[] }>();
  for (const log of allFinished) {
    if (!finishedByBook.has(log.bookId)) finishedByBook.set(log.bookId, { book: log.book, logs: [] });
    finishedByBook.get(log.bookId)!.logs.push(log);
  }
  const mostReadBooks: MostReadBook[] = [...finishedByBook.values()]
    .filter(({ logs }) => logs.length >= 2)
    .map(({ book, logs }) => {
      const rated     = logs.filter(l => l.rating !== null) as Array<LogWithBook & { rating: number }>;
      const avgRating = rated.length ? rated.reduce((s, l) => s + l.rating, 0) / rated.length : null;
      return { book, finishers: logs.length, avgRating };
    })
    .sort((a, b) => b.finishers - a.finishers || (b.avgRating ?? 0) - (a.avgRating ?? 0))
    .slice(0, 10);

  // Top genres
  const genreCounts: Record<string, number> = {};
  for (const log of allFinished) {
    let genres: string[] = [];
    try { genres = JSON.parse(log.book.genres ?? '[]'); } catch { /* skip */ }
    for (const g of genres) genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  }
  const topGenres = Object.entries(genreCounts)
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Currently reading
  const nameMap = resolveNames([...byUser.keys()]);
  const currentlyReading: CurrentlyReadingEntry[] = allReading
    .map(l => ({
      userId:      l.userId,
      displayName: nameMap.get(l.userId) ?? l.userId,
      book:        l.book,
      progress:    l.progress,
    }))
    .sort((a, b) => b.progress - a.progress);

  return {
    totalFinished:        allFinished.length,
    uniqueBooksRead:      uniqueBookIds.size,
    activeMembers:        byUser.size,
    currentlyReadingCount: allReading.length,
    botmByYear,
    mostReadBooks,
    topGenres,
    currentlyReading,
  };
}

// ── Book detail ───────────────────────────────────────────────────────────────

export interface BookMemberRow {
  userId:      string;
  displayName: string;
  status:      string;
  progress:    number;
  rating:      number | null;
  startedAt:   Date;
  finishedAt:  Date | null;
}

export interface BookDetail {
  book:       Book;
  isBotm:     boolean;
  botmMonth:  number | null;
  botmYear:   number | null;
  members:    BookMemberRow[];
  finishers:  number;
  enrolled:   number;
  avgRating:  number | null;
}

export async function computeBookDetail(bookId: number): Promise<BookDetail | null> {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) return null;

  const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, bookId)).get();
  const isBotm   = !!(clubBook?.month && clubBook?.year);

  const logs = (await db.query.readingLogs.findMany({
    where:   (rl, { eq }) => eq(rl.bookId, bookId),
    with:    { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];

  if (!logs.length) return { book, isBotm, botmMonth: clubBook?.month ?? null, botmYear: clubBook?.year ?? null, members: [], finishers: 0, enrolled: 0, avgRating: null };

  // Deduplicate per user
  const byUser = new Map<string, LogWithBook[]>();
  for (const log of logs) {
    if (!byUser.has(log.userId)) byUser.set(log.userId, []);
    byUser.get(log.userId)!.push(log);
  }

  const nameMap = resolveNames([...byUser.keys()]);

  const members: BookMemberRow[] = [];
  for (const [userId, userLogs] of byUser) {
    const [deduped] = deduplicateByBook(userLogs);
    members.push({
      userId,
      displayName: nameMap.get(userId) ?? userId,
      status:      deduped.status,
      progress:    deduped.progress,
      rating:      deduped.rating,
      startedAt:   deduped.startedAt,
      finishedAt:  deduped.finishedAt,
    });
  }

  members.sort((a, b) => {
    const order = { finished: 0, reading: 1, abandoned: 2, dnr: 3 };
    return (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4)
      || a.displayName.localeCompare(b.displayName);
  });

  const finishers = members.filter(m => m.status === 'finished').length;
  const rated     = members.filter(m => m.rating !== null) as Array<BookMemberRow & { rating: number }>;
  const avgRating = rated.length ? rated.reduce((s, m) => s + m.rating, 0) / rated.length : null;

  return {
    book,
    isBotm,
    botmMonth: clubBook?.month ?? null,
    botmYear:  clubBook?.year  ?? null,
    members,
    finishers,
    enrolled: members.length,
    avgRating,
  };
}
