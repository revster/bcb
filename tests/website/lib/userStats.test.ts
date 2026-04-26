// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockFindMany = jest.fn();
const mockAll      = jest.fn();

jest.mock('../../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    all:     mockAll,
  };
  return {
    select: jest.fn(() => chain),
    query: {
      readingLogs: { findMany: mockFindMany },
    },
  };
});

import { computeUserStats } from '../../../website/lib/userStats';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const THIS_YEAR    = new Date();
const OLD_DATE     = new Date('2020-01-01');
const OLDER_DATE   = new Date('2019-06-01');

const BOOK_A    = { id: 10, title: 'Book A', pages: 200, genres: '["Fiction","Classics"]' };
const BOOK_B    = { id: 11, title: 'Book B', pages: 300, genres: '["Science Fiction"]' };
const BOOK_LONG = { id: 13, title: 'Long Book', pages: 900, genres: '[]' };
const BOOK_NONE = { id: 14, title: 'No Pages', pages: null, genres: '[]' };

function makeLog(bookId: number, status: string, opts: {
  rating?:     number | null;
  book?:       { id?: number; title?: string; pages: number | null; genres: string };
  startedAt?:  Date;
  finishedAt?: Date | null;
  progress?:   number;
} = {}) {
  return {
    id:         bookId * 100,
    userId:     'user-1',
    bookId,
    threadId:   null,
    status,
    progress:   opts.progress  ?? 0,
    rating:     opts.rating    ?? null,
    startedAt:  opts.startedAt ?? OLD_DATE,
    finishedAt: opts.finishedAt ?? (status === 'finished' ? OLD_DATE : null),
    updatedAt:  OLD_DATE,
    book: { title: 'Untitled', id: bookId, ...opts.book },
  };
}

function makeClubBook(bookId: number, { month = null as number | null, year = null as number | null } = {}) {
  return { bookId, month, year };
}

beforeEach(() => {
  mockAll.mockReturnValue([]);
});
afterEach(() => { mockAll.mockReset(); jest.clearAllMocks(); });

// ── No data ───────────────────────────────────────────────────────────────────

describe('no data', () => {
  test('returns null when user has no logs', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await computeUserStats('user-1')).toBeNull();
  });
});

// ── memberSince ───────────────────────────────────────────────────────────────

describe('memberSince', () => {
  test('is the startedAt of the earliest log', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { startedAt: OLD_DATE }),
      makeLog(2, 'finished', { startedAt: THIS_YEAR }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.memberSince).toEqual(OLD_DATE);
  });
});

// ── All-time counts ───────────────────────────────────────────────────────────

describe('all-time counts', () => {
  test('counts finished, reading, and abandoned correctly', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'reading'),
      makeLog(3, 'abandoned'),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.allFinished).toHaveLength(1);
    expect(stats!.allReading).toHaveLength(1);
    expect(stats!.allAbandoned).toHaveLength(1);
  });

  test('currentlyReading matches allReading', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'reading', { progress: 45 }),
      makeLog(2, 'finished'),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.currentlyReading).toHaveLength(1);
    expect(stats!.currentlyReading[0].bookId).toBe(1);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('deduplication', () => {
  test('finished + reading for same book → 1 finished, 0 reading', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(1, 'reading'),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.allFinished).toHaveLength(1);
    expect(stats!.allReading).toHaveLength(0);
  });

  test('two abandoned logs for same book → 1 abandoned', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'abandoned'),
      makeLog(1, 'abandoned'),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.allAbandoned).toHaveLength(1);
  });

  test('history table deduplicates too', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(1, 'reading'),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.history).toHaveLength(1);
    expect(stats!.history[0].status).toBe('finished');
  });
});

// ── This-year counts ──────────────────────────────────────────────────────────

describe('this-year counts', () => {
  test('counts only logs started this year', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { startedAt: THIS_YEAR }),
      makeLog(2, 'finished', { startedAt: THIS_YEAR }),
      makeLog(3, 'finished', { startedAt: OLD_DATE }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.thisYearFinished).toHaveLength(2);
    expect(stats!.allFinished).toHaveLength(3);
  });

  test('past-year logs do not appear in this-year counts', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'reading', { startedAt: OLD_DATE }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.thisYearReading).toHaveLength(0);
    expect(stats!.thisYearFinished).toHaveLength(0);
    expect(stats!.thisYearAbandoned).toHaveLength(0);
  });
});

// ── Total pages ───────────────────────────────────────────────────────────────

describe('totalPages', () => {
  test('sums pages from finished books only', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: { pages: 200, genres: '[]' } }),
      makeLog(2, 'finished', { book: { pages: 300, genres: '[]' } }),
      makeLog(3, 'reading',  { book: { pages: 999, genres: '[]' } }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.totalPages).toBe(500);
  });

  test('is 0 when no finished books', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'reading')]);
    const stats = await computeUserStats('user-1');
    expect(stats!.totalPages).toBe(0);
  });

  test('does not double-count pages when same book has two logs', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: { pages: 300, genres: '[]' } }),
      makeLog(1, 'reading',  { book: { pages: 300, genres: '[]' } }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.totalPages).toBe(300);
  });
});

// ── Average rating ────────────────────────────────────────────────────────────

describe('avgRating', () => {
  test('averages across all rated logs', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { rating: 4 }),
      makeLog(2, 'finished', { rating: 2 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.avgRating).toBeCloseTo(3);
  });

  test('is null when no logs have ratings', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    const stats = await computeUserStats('user-1');
    expect(stats!.avgRating).toBeNull();
  });
});

// ── Favourite genre ───────────────────────────────────────────────────────────

describe('favouriteGenre', () => {
  test('returns most common genre across finished books', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: { pages: 100, genres: '["Fiction","Classics"]' } }),
      makeLog(2, 'finished', { book: { pages: 100, genres: '["Fiction"]' } }),
      makeLog(3, 'finished', { book: { pages: 100, genres: '["Classics"]' } }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.favouriteGenre).toBe('Fiction');
  });

  test('is null when finished books have no genres', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NONE })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.favouriteGenre).toBeNull();
  });

  test('only counts genres from finished books, not reading/abandoned', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished',  { book: { pages: 100, genres: '["Fiction"]' } }),
      makeLog(2, 'reading',   { book: { pages: 100, genres: '["Horror","Horror","Horror"]' } }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.favouriteGenre).toBe('Fiction');
  });
});

// ── Genre counts ──────────────────────────────────────────────────────────────

describe('genreCounts', () => {
  test('returns genres sorted by count descending', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: { pages: 100, genres: '["Fiction","Classics"]' } }),
      makeLog(2, 'finished', { book: { pages: 100, genres: '["Fiction"]' } }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.genreCounts[0].genre).toBe('Fiction');
    expect(stats!.genreCounts[0].count).toBe(2);
    expect(stats!.genreCounts[1].genre).toBe('Classics');
    expect(stats!.genreCounts[1].count).toBe(1);
  });

  test('is empty when no finished books', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'reading')]);
    const stats = await computeUserStats('user-1');
    expect(stats!.genreCounts).toHaveLength(0);
  });
});

// ── Highlights ────────────────────────────────────────────────────────────────

describe('highlights', () => {
  test('longestBook is the finished book with the most pages', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: BOOK_A }),
      makeLog(2, 'finished', { book: BOOK_LONG }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestBook!.book.title).toBe('Long Book');
  });

  test('longestBook is null when no finished books have page counts', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NONE })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestBook).toBeNull();
  });

  test('does not count reading books as longest', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'reading',  { book: BOOK_LONG }),
      makeLog(2, 'finished', { book: BOOK_A }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestBook!.book.title).toBe('Book A');
  });

  test('highestRated is the log with the highest rating', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { rating: 3 }),
      makeLog(2, 'finished', { rating: 5 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.highestRated!.bookId).toBe(2);
    expect(stats!.highestRated!.rating).toBe(5);
  });

  test('highestRated is null when no logs have ratings', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    const stats = await computeUserStats('user-1');
    expect(stats!.highestRated).toBeNull();
  });

  test('mostRecentFinish is the finished log with the latest finishedAt', async () => {
    const earlier = new Date('2024-01-01');
    const later   = new Date('2024-06-01');
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { finishedAt: earlier }),
      makeLog(2, 'finished', { finishedAt: later }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.mostRecentFinish!.bookId).toBe(2);
  });

  test('mostRecentFinish is null when no books are finished', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'reading')]);
    const stats = await computeUserStats('user-1');
    expect(stats!.mostRecentFinish).toBeNull();
  });
});

// ── History table ─────────────────────────────────────────────────────────────

describe('history', () => {
  test('is sorted most-recent startedAt first', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { startedAt: OLDER_DATE }),
      makeLog(2, 'finished', { startedAt: OLD_DATE }),
      makeLog(3, 'finished', { startedAt: THIS_YEAR }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.history[0].bookId).toBe(3);
    expect(stats!.history[1].bookId).toBe(2);
    expect(stats!.history[2].bookId).toBe(1);
  });

  test('isBotm is true for books that are club reads with month+year', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'finished'),
    ]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    const byId = new Map(stats!.history.map(l => [l.bookId, l]));
    expect(byId.get(1)!.isBotm).toBe(true);
    expect(byId.get(2)!.isBotm).toBe(false);
  });

  test('isBotm is false for club reads without month/year', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1)]); // no month/year
    const stats = await computeUserStats('user-1');
    expect(stats!.history[0].isBotm).toBe(false);
  });

  test('historyYears contains unique years sorted descending', async () => {
    // Use local-time constructors to avoid UTC-midnight timezone edge cases
    const year2022 = new Date(2022, 5, 1);
    const year2021 = new Date(2021, 5, 1);
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { startedAt: THIS_YEAR }),
      makeLog(2, 'finished', { startedAt: year2022 }),
      makeLog(3, 'finished', { startedAt: year2021 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.historyYears[0]).toBe(CURRENT_YEAR);
    expect(stats!.historyYears).toContain(2022);
    expect(stats!.historyYears).toContain(2021);
    // Years are sorted descending
    for (let i = 0; i < stats!.historyYears.length - 1; i++) {
      expect(stats!.historyYears[i]).toBeGreaterThan(stats!.historyYears[i + 1]);
    }
  });
});

// ── BOTM stats ────────────────────────────────────────────────────────────────

describe('BOTM stats', () => {
  test('hasBotm is false when no club books with month+year', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1)]); // no month/year
    const stats = await computeUserStats('user-1');
    expect(stats!.hasBotm).toBe(false);
  });

  test('hasBotm is false when user has no logs for any BOTM book', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(2, { month: 1, year: 2025 })]); // different book
    const stats = await computeUserStats('user-1');
    expect(stats!.hasBotm).toBe(false);
  });

  test('hasBotm is true when user has a log for a BOTM book', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.hasBotm).toBe(true);
  });

  test('botmAllTime counts and rate are correct', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'finished'),
      makeLog(3, 'abandoned'),
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2, { month: 2, year: 2025 }),
      makeClubBook(3, { month: 3, year: 2025 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmAllTime.finished).toBe(2);
    expect(stats!.botmAllTime.total).toBe(3);
    expect(stats!.botmAllTime.rate).toBe(67);
  });

  test('botmThisYear is null when no club books are from this year', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2020 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmThisYear).toBeNull();
  });

  test('botmThisYear counts only this-year club books', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'finished'),
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: CURRENT_YEAR }),
      makeClubBook(2, { month: 2, year: 2020 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmThisYear!.finished).toBe(1);
    expect(stats!.botmThisYear!.total).toBe(1);
    expect(stats!.botmAllTime.total).toBe(2);
  });

  test('botmAllTime avgRating is null when no club logs have ratings', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmAllTime.avgRating).toBeNull();
  });

  test('botmAllTime avgRating averages only club book ratings', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { rating: 5 }),  // BOTM
      makeLog(2, 'finished', { rating: 1 }),  // personal
    ]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmAllTime.avgRating).toBeCloseTo(5);
  });
});

// ── BOTM streak ───────────────────────────────────────────────────────────────

describe('longestStreak', () => {
  test('is 0 when user never finished a BOTM book', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'abandoned')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestStreak).toBe(0);
  });

  test('counts consecutive finishes correctly', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'finished'),
      makeLog(3, 'finished'),
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2, { month: 2, year: 2025 }),
      makeClubBook(3, { month: 3, year: 2025 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestStreak).toBe(3);
  });

  test('resets on an unfinished month', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'abandoned'), // breaks streak
      makeLog(3, 'finished'),
      makeLog(4, 'finished'),
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2, { month: 2, year: 2025 }),
      makeClubBook(3, { month: 3, year: 2025 }),
      makeClubBook(4, { month: 4, year: 2025 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestStreak).toBe(2);
  });

  test('finishing any one book in a shared month keeps the streak alive', async () => {
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished'),
      makeLog(2, 'abandoned'), // same month as book 1 — but book 1 finished
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2, { month: 1, year: 2025 }),
    ]);
    const stats = await computeUserStats('user-1');
    expect(stats!.longestStreak).toBe(1);
  });
});

// ── BOTM grid ─────────────────────────────────────────────────────────────────

describe('botmGrid', () => {
  test('is empty when no BOTM books exist', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmGrid).toHaveLength(0);
  });

  test('each row has 12 cells (one per month)', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    expect(stats!.botmGrid[0].cells).toHaveLength(12);
  });

  test('cell for a BOTM month the user finished has status "finished"', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 3, year: 2025 })]); // March
    const stats = await computeUserStats('user-1');
    const row = stats!.botmGrid.find(r => r.year === 2025)!;
    expect(row.cells[2].status).toBe('finished'); // index 2 = March
  });

  test('cell for a BOTM month with no user log has status "not-enrolled"', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]); // only book 1
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2, { month: 2, year: 2025 }), // user has no log for book 2
    ]);
    const stats = await computeUserStats('user-1');
    const row = stats!.botmGrid.find(r => r.year === 2025)!;
    expect(row.cells[1].status).toBe('not-enrolled'); // February
  });

  test('cell for a month with no BOTM book has status null', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]); // only January
    const stats = await computeUserStats('user-1');
    const row = stats!.botmGrid.find(r => r.year === 2025)!;
    expect(row.cells[5].status).toBeNull(); // June — no BOTM that month
  });

  test('grid includes a row per year from first BOTM year to current year', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2023 })]);
    const stats = await computeUserStats('user-1');
    const years = stats!.botmGrid.map(r => r.year);
    expect(years).toContain(2023);
    expect(years).toContain(CURRENT_YEAR);
    // All years from 2023 to CURRENT_YEAR should be present
    for (let y = 2023; y <= CURRENT_YEAR; y++) {
      expect(years).toContain(y);
    }
  });

  test('dnr log is reflected in grid cell', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'dnr')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 5, year: 2025 })]); // May
    const stats = await computeUserStats('user-1');
    const row = stats!.botmGrid.find(r => r.year === 2025)!;
    expect(row.cells[4].status).toBe('dnr'); // index 4 = May
  });

  test('cell includes the book title for tooltip', async () => {
    mockFindMany.mockResolvedValue([makeLog(10, 'finished', { book: BOOK_A })]);
    mockAll.mockReturnValue([makeClubBook(10, { month: 1, year: 2025 })]);
    const stats = await computeUserStats('user-1');
    const row = stats!.botmGrid.find(r => r.year === 2025)!;
    expect(row.cells[0].bookTitle).toBe('Book A');
  });
});
