/**
 * website/lib/userStats.ts
 *
 * Pure stat-computation functions for the user stats page.
 * Ported from commands/stats.ts but returns structured data instead of
 * building Discord embeds.
 */

import db = require('../../db');
import { asc } from 'drizzle-orm';
import { clubBooks } from '../../schema';
import type { LogWithBook } from '../../schema';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GenreCount {
  genre: string;
  count: number;
}

export interface BotmCell {
  bookId:    number | null;
  bookTitle: string | null;
  /** 'finished' | 'reading' | 'abandoned' | 'dnr' | 'not-enrolled' | null (no BOTM that month) */
  status:    string | null;
}

export interface BotmGridRow {
  year:  number;
  cells: BotmCell[]; // index 0–11 = Jan–Dec
}

export interface BotmStats {
  finished:  number;
  total:     number;
  rate:      number; // 0–100 integer
  avgRating: number | null;
}

export interface UserStats {
  memberSince: Date | null;

  // Currently in-progress books
  currentlyReading: LogWithBook[];

  // All-time deduplicated logs by effective status
  allFinished:  LogWithBook[];
  allReading:   LogWithBook[];
  allAbandoned: LogWithBook[];
  totalPages:   number;
  avgRating:    number | null;

  // This-year subset (by startedAt year)
  thisYearFinished:  LogWithBook[];
  thisYearReading:   LogWithBook[];
  thisYearAbandoned: LogWithBook[];

  // Highlights
  favouriteGenre:  string | null;
  longestBook:     LogWithBook | null;
  highestRated:    LogWithBook | null;
  mostRecentFinish: LogWithBook | null;

  // Genre breakdown (top 10 genres across finished books)
  genreCounts: GenreCount[];

  // BOTM
  hasBotm:      boolean;
  botmAllTime:  BotmStats;
  botmThisYear: BotmStats | null;
  longestStreak: number;
  botmGrid:     BotmGridRow[];

  // Full reading history for the table (most recent first, deduplicated)
  history:      Array<LogWithBook & { isBotm: boolean }>;
  historyYears: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deduplicates logs by bookId, keeping one effective status per book.
 * Priority: finished > reading > abandoned > dnr.
 * Logs must be pre-sorted by startedAt asc so the last entry per book
 * carries the most recent metadata.
 */
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

/**
 * Longest streak of consecutive BOTM completions.
 * Finishing any one book in a shared month keeps the streak alive.
 * An in-progress book in the final month does not break the streak.
 */
function computeLongestStreak(
  clubBookRows: Array<{ bookId: number; month: number | null; year: number | null }>,
  statusByBookId: Map<number, string>,
): number {
  const eligible = clubBookRows.filter(cb => cb.month !== null && cb.year !== null);

  const monthMap = new Map<string, number[]>();
  for (const cb of eligible) {
    const key = `${cb.year}-${cb.month}`;
    if (!monthMap.has(key)) monthMap.set(key, []);
    monthMap.get(key)!.push(cb.bookId);
  }

  const sortedMonths = [...monthMap.entries()].sort(([a], [b]) => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return ay !== by ? ay - by : am - bm;
  });

  const firstIdx = sortedMonths.findIndex(([, ids]) => ids.some(id => statusByBookId.has(id)));
  if (firstIdx === -1) return 0;

  let best = 0;
  let current = 0;
  for (let i = firstIdx; i < sortedMonths.length; i++) {
    const [, ids] = sortedMonths[i];
    const isLast   = i === sortedMonths.length - 1;
    const statuses = ids.map(id => statusByBookId.get(id));

    if (statuses.some(s => s === 'finished')) {
      if (++current > best) best = current;
    } else if (statuses.some(s => s === 'reading') && isLast) {
      // in-progress at end of history — don't break streak
    } else {
      current = 0;
    }
  }
  return best;
}

function computeGenreCounts(logs: LogWithBook[]): GenreCount[] {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    let genres: string[] = [];
    try { genres = JSON.parse(log.book.genres ?? '[]'); } catch { /* skip */ }
    for (const g of genres) counts[g] = (counts[g] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function computeAvgRating(logs: Array<{ rating: number | null }>): number | null {
  const rated = logs.filter(l => l.rating !== null) as Array<{ rating: number }>;
  if (!rated.length) return null;
  return rated.reduce((s, l) => s + l.rating, 0) / rated.length;
}

function buildBotmGrid(
  clubBookRows: Array<{ bookId: number; month: number | null; year: number | null }>,
  statusByBookId: Map<number, string>,
  titleByBookId: Map<number, string>,
  currentYear: number,
): BotmGridRow[] {
  const botmBooks = clubBookRows.filter(cb => cb.month !== null && cb.year !== null);
  if (!botmBooks.length) return [];

  const years   = [...new Set(botmBooks.map(cb => cb.year!))].sort((a, b) => a - b);
  const minYear = years[0];
  const maxYear = Math.max(years[years.length - 1], currentYear);

  // year → month → bookId
  const yearMonthMap = new Map<number, Map<number, number>>();
  for (const cb of botmBooks) {
    if (!yearMonthMap.has(cb.year!)) yearMonthMap.set(cb.year!, new Map());
    yearMonthMap.get(cb.year!)!.set(cb.month!, cb.bookId);
  }

  const rows: BotmGridRow[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    const cells: BotmCell[] = [];
    for (let month = 1; month <= 12; month++) {
      const bookId = yearMonthMap.get(year)?.get(month) ?? null;
      if (bookId === null) {
        cells.push({ bookId: null, bookTitle: null, status: null });
      } else {
        cells.push({
          bookId,
          bookTitle: titleByBookId.get(bookId) ?? null,
          status:    statusByBookId.has(bookId) ? statusByBookId.get(bookId)! : 'not-enrolled',
        });
      }
    }
    rows.push({ year, cells });
  }
  return rows;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeUserStats(userId: string): Promise<UserStats | null> {
  const currentYear = new Date().getFullYear();

  const rawLogs = (await db.query.readingLogs.findMany({
    where:   (rl, { eq }) => eq(rl.userId, userId),
    with:    { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];

  if (!rawLogs.length) return null;

  const clubBookRows = db
    .select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
    .from(clubBooks)
    .orderBy(asc(clubBooks.year), asc(clubBooks.month))
    .all();

  const botmBookIds = new Set(
    clubBookRows.filter(cb => cb.month !== null && cb.year !== null).map(cb => cb.bookId),
  );
  const clubBookYearMap = new Map(clubBookRows.map(cb => [cb.bookId, cb.year]));

  const uniqueLogs = deduplicateByBook(rawLogs);

  // BOTM subsets
  const clubLogs        = uniqueLogs.filter(l => botmBookIds.has(l.bookId));
  const clubLogsThisYear = clubLogs.filter(l => clubBookYearMap.get(l.bookId) === currentYear);

  // All-time by status
  const allFinished  = uniqueLogs.filter(l => l.status === 'finished');
  const allReading   = uniqueLogs.filter(l => l.status === 'reading');
  const allAbandoned = uniqueLogs.filter(l => l.status === 'abandoned');

  // This-year subset
  const thisYearLogs     = uniqueLogs.filter(l => l.startedAt.getFullYear() === currentYear);
  const thisYearFinished  = thisYearLogs.filter(l => l.status === 'finished');
  const thisYearReading   = thisYearLogs.filter(l => l.status === 'reading');
  const thisYearAbandoned = thisYearLogs.filter(l => l.status === 'abandoned');

  // Aggregates
  const totalPages = allFinished.reduce((s, l) => s + (l.book.pages ?? 0), 0);
  const genreCounts = computeGenreCounts(allFinished);

  // Highlights
  const longestBook = allFinished
    .filter(l => l.book.pages !== null)
    .sort((a, b) => (b.book.pages ?? 0) - (a.book.pages ?? 0))[0] ?? null;

  const highestRated = uniqueLogs
    .filter(l => l.rating !== null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null;

  const mostRecentFinish = allFinished
    .filter(l => l.finishedAt !== null)
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0] ?? null;

  // BOTM
  const clubFinished        = clubLogs.filter(l => l.status === 'finished');
  const clubFinishedThisYear = clubLogsThisYear.filter(l => l.status === 'finished');
  const statusByBotmBookId  = new Map(clubLogs.map(l => [l.bookId, l.status]));

  const hasBotm = clubLogs.length > 0;

  const botmAllTime: BotmStats = {
    finished:  clubFinished.length,
    total:     clubLogs.length,
    rate:      clubLogs.length ? Math.round((clubFinished.length / clubLogs.length) * 100) : 0,
    avgRating: computeAvgRating(clubLogs),
  };

  const botmThisYear: BotmStats | null = clubLogsThisYear.length > 0 ? {
    finished:  clubFinishedThisYear.length,
    total:     clubLogsThisYear.length,
    rate:      Math.round((clubFinishedThisYear.length / clubLogsThisYear.length) * 100),
    avgRating: computeAvgRating(clubLogsThisYear),
  } : null;

  const longestStreak = computeLongestStreak(clubBookRows, statusByBotmBookId);

  const titleByBookId = new Map(rawLogs.map(l => [l.bookId, l.book.title]));
  const botmGrid = buildBotmGrid(clubBookRows, statusByBotmBookId, titleByBookId, currentYear);

  // History table
  const history = [...uniqueLogs]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map(l => ({ ...l, isBotm: botmBookIds.has(l.bookId) }));

  const historyYears = [...new Set(history.map(l => l.startedAt.getFullYear()))].sort((a, b) => b - a);

  return {
    memberSince:       rawLogs[0]?.startedAt ?? null,
    currentlyReading:  allReading,
    allFinished,
    allReading,
    allAbandoned,
    totalPages,
    avgRating:         computeAvgRating(uniqueLogs),
    thisYearFinished,
    thisYearReading,
    thisYearAbandoned,
    favouriteGenre:    genreCounts[0]?.genre ?? null,
    longestBook,
    highestRated,
    mostRecentFinish,
    genreCounts,
    hasBotm,
    botmAllTime,
    botmThisYear,
    longestStreak,
    botmGrid,
    history,
    historyYears,
  };
}
