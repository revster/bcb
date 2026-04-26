// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockFindMany = jest.fn();
const mockAll      = jest.fn();
const mockGet      = jest.fn();

jest.mock('../../../db', () => {
  const selectChain: any = {
    from:    jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get:     mockGet,
    all:     mockAll,
  };
  return {
    select: jest.fn(() => selectChain),
    query: {
      readingLogs: { findMany: mockFindMany },
    },
  };
});

import { computeLeaderboard, computeClubOverview, computeBookDetail } from '../../../website/lib/clubStats';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DATE_2022 = new Date(2022, 5, 1);
const DATE_2023 = new Date(2023, 5, 1);

const BOOK_A = { id: 10, title: 'Book A', author: 'Author A', pages: 200, genres: '["Fiction"]', imageUrl: null, goodreadsUrl: null };
const BOOK_B = { id: 11, title: 'Book B', author: 'Author B', pages: 300, genres: '["Science Fiction"]', imageUrl: null, goodreadsUrl: null };

function makeLog(userId: string, bookId: number, status: string, opts: {
  rating?:     number | null;
  progress?:   number;
  startedAt?:  Date;
  finishedAt?: Date | null;
  book?:       Record<string, unknown>;
} = {}) {
  return {
    id:         Math.random(),
    userId,
    bookId,
    threadId:   null,
    status,
    progress:   opts.progress    ?? (status === 'finished' ? 100 : 50),
    rating:     opts.rating      ?? null,
    startedAt:  opts.startedAt   ?? DATE_2022,
    finishedAt: opts.finishedAt  ?? (status === 'finished' ? DATE_2022 : null),
    updatedAt:  DATE_2022,
    book: opts.book ?? (bookId === 10 ? BOOK_A : BOOK_B),
  };
}

function makeClubBook(bookId: number, month: number | null = 1, year: number | null = 2022) {
  return { bookId, month, year };
}

afterEach(() => {
  mockAll.mockReset();
  mockGet.mockReset();
  mockFindMany.mockReset();
  jest.clearAllMocks();
});

// ── computeLeaderboard ────────────────────────────────────────────────────────

describe('computeLeaderboard', () => {
  test('returns empty rows when no logs', async () => {
    mockFindMany.mockResolvedValue([]);
    mockAll.mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.rows).toHaveLength(0);
    expect(result.years).toHaveLength(0);
  });

  test('ranks members by finished count descending', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-1', 11, 'finished'),
      makeLog('user-2', 10, 'finished'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10), makeClubBook(11)]) // clubBooks
      .mockReturnValue([]);                                       // resolveNames

    const result = await computeLeaderboard();
    expect(result.rows[0].userId).toBe('user-1');
    expect(result.rows[0].finished).toBe(2);
    expect(result.rows[1].userId).toBe('user-2');
    expect(result.rows[1].finished).toBe(1);
  });

  test('filters by year when filterYear provided', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished', { startedAt: DATE_2022 }),
      makeLog('user-1', 11, 'finished', { startedAt: DATE_2023 }),
      makeLog('user-2', 11, 'finished', { startedAt: DATE_2023 }),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10, 1, 2022), makeClubBook(11, 1, 2023)])
      .mockReturnValue([]);

    const result = await computeLeaderboard(2022);
    // Only book 10 is in 2022
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].userId).toBe('user-1');
    expect(result.rows[0].finished).toBe(1);
  });

  test('excludes non-botm books (no month/year)', async () => {
    const logs = [makeLog('user-1', 10, 'finished')];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([{ bookId: 10, month: null, year: null }]) // club book without month/year
      .mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.rows).toHaveLength(0);
  });

  test('computes avgRating correctly', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished', { rating: 4 }),
      makeLog('user-1', 11, 'finished', { rating: 2 }),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10), makeClubBook(11)])
      .mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.rows[0].avgRating).toBeCloseTo(3);
  });

  test('deduplicates multiple logs for same user+book, finished wins', async () => {
    const logs = [
      makeLog('user-1', 10, 'reading'),
      makeLog('user-1', 10, 'finished'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10)])
      .mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.rows[0].finished).toBe(1);
    expect(result.rows[0].enrolled).toBe(1);
  });

  test('returns available years sorted descending', async () => {
    mockFindMany.mockResolvedValue([]);
    mockAll
      .mockReturnValueOnce([
        makeClubBook(10, 1, 2022),
        makeClubBook(11, 2, 2023),
        makeClubBook(12, 3, 2021),
      ])
      .mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.years).toEqual([2023, 2022, 2021]);
  });

  test('computes rate as percentage', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-1', 11, 'reading'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10), makeClubBook(11)])
      .mockReturnValue([]);

    const result = await computeLeaderboard();
    expect(result.rows[0].rate).toBe(50);
    expect(result.rows[0].enrolled).toBe(2);
  });
});

// ── computeClubOverview ───────────────────────────────────────────────────────

describe('computeClubOverview', () => {
  test('returns zeroed totals when no logs', async () => {
    mockFindMany.mockResolvedValue([]);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.totalFinished).toBe(0);
    expect(result.uniqueBooksRead).toBe(0);
    expect(result.activeMembers).toBe(0);
    expect(result.currentlyReadingCount).toBe(0);
    expect(result.botmByYear).toHaveLength(0);
    expect(result.mostReadBooks).toHaveLength(0);
    expect(result.topGenres).toHaveLength(0);
    expect(result.currentlyReading).toHaveLength(0);
  });

  test('counts totalFinished and uniqueBooksRead correctly', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-1', 11, 'finished'),
      makeLog('user-2', 10, 'finished'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.totalFinished).toBe(3);
    expect(result.uniqueBooksRead).toBe(2); // books 10 and 11
  });

  test('counts activeMembers as unique userIds', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-2', 11, 'reading'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.activeMembers).toBe(2);
  });

  test('currentlyReadingCount reflects reading status logs', async () => {
    const logs = [
      makeLog('user-1', 10, 'reading', { progress: 40 }),
      makeLog('user-2', 11, 'reading', { progress: 60 }),
      makeLog('user-3', 10, 'finished'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.currentlyReadingCount).toBe(2);
    expect(result.currentlyReading).toHaveLength(2);
  });

  test('mostReadBooks only includes books with 2+ finishers', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-2', 10, 'finished'),
      makeLog('user-3', 11, 'finished'), // only 1 finisher
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.mostReadBooks).toHaveLength(1);
    expect(result.mostReadBooks[0].book.id).toBe(10);
    expect(result.mostReadBooks[0].finishers).toBe(2);
  });

  test('topGenres aggregates genres from finished books', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished', { book: { ...BOOK_A, genres: '["Fiction","Fantasy"]' } }),
      makeLog('user-2', 10, 'finished', { book: { ...BOOK_A, genres: '["Fiction","Fantasy"]' } }),
      makeLog('user-1', 11, 'finished', { book: { ...BOOK_B, genres: '["Fantasy"]' } }),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeClubOverview();
    const genres = new Map(result.topGenres.map(g => [g.genre, g.count]));
    expect(genres.get('Fantasy')).toBe(3);
    expect(genres.get('Fiction')).toBe(2);
    // Sorted descending
    expect(result.topGenres[0].genre).toBe('Fantasy');
  });

  test('botmByYear groups and computes stats correctly', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished'),
      makeLog('user-2', 10, 'finished'),
      makeLog('user-1', 11, 'reading'),
    ];
    mockFindMany.mockResolvedValue(logs);
    mockAll
      .mockReturnValueOnce([makeClubBook(10, 1, 2022), makeClubBook(11, 2, 2022)])
      .mockReturnValue([]);

    const result = await computeClubOverview();
    expect(result.botmByYear).toHaveLength(1);
    const yearRow = result.botmByYear[0];
    expect(yearRow.year).toBe(2022);
    expect(yearRow.books).toBe(2);
    expect(yearRow.avgEnrolled).toBe(2); // (2 + 1) / 2 = 1.5 → 2
  });
});

// ── computeBookDetail ─────────────────────────────────────────────────────────

describe('computeBookDetail', () => {
  test('returns null when book not found', async () => {
    mockGet.mockReturnValue(undefined);

    const result = await computeBookDetail(999);
    expect(result).toBeNull();
  });

  test('returns book detail with empty members when no logs', async () => {
    mockGet
      .mockReturnValueOnce(BOOK_A) // books.get()
      .mockReturnValueOnce(null);  // clubBooks.get()
    mockFindMany.mockResolvedValue([]);
    mockAll.mockReturnValue([]);

    const result = await computeBookDetail(10);
    expect(result).not.toBeNull();
    expect(result!.book).toMatchObject({ id: 10 });
    expect(result!.isBotm).toBe(false);
    expect(result!.members).toHaveLength(0);
    expect(result!.finishers).toBe(0);
    expect(result!.enrolled).toBe(0);
    expect(result!.avgRating).toBeNull();
  });

  test('marks isBotm correctly when clubBook has month and year', async () => {
    mockGet
      .mockReturnValueOnce(BOOK_A)
      .mockReturnValueOnce({ bookId: 10, month: 3, year: 2022 });
    mockFindMany.mockResolvedValue([]);
    mockAll.mockReturnValue([]);

    const result = await computeBookDetail(10);
    expect(result!.isBotm).toBe(true);
    expect(result!.botmMonth).toBe(3);
    expect(result!.botmYear).toBe(2022);
  });

  test('computes finishers and avgRating correctly', async () => {
    const logs = [
      makeLog('user-1', 10, 'finished', { rating: 4, book: BOOK_A }),
      makeLog('user-2', 10, 'finished', { rating: 2, book: BOOK_A }),
      makeLog('user-3', 10, 'reading',  { book: BOOK_A }),
    ];
    mockGet
      .mockReturnValueOnce(BOOK_A)
      .mockReturnValueOnce(null);
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeBookDetail(10);
    expect(result!.finishers).toBe(2);
    expect(result!.enrolled).toBe(3);
    expect(result!.avgRating).toBeCloseTo(3);
  });

  test('deduplicates logs per user and applies status priority', async () => {
    const logs = [
      makeLog('user-1', 10, 'abandoned', { book: BOOK_A }),
      makeLog('user-1', 10, 'finished',  { book: BOOK_A }),
    ];
    mockGet
      .mockReturnValueOnce(BOOK_A)
      .mockReturnValueOnce(null);
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeBookDetail(10);
    expect(result!.members).toHaveLength(1);
    expect(result!.members[0].status).toBe('finished');
    expect(result!.finishers).toBe(1);
  });

  test('sorts members: finished, reading, abandoned, dnr', async () => {
    const logs = [
      makeLog('user-1', 10, 'dnr',      { book: BOOK_A }),
      makeLog('user-2', 10, 'reading',  { book: BOOK_A }),
      makeLog('user-3', 10, 'finished', { book: BOOK_A }),
      makeLog('user-4', 10, 'abandoned',{ book: BOOK_A }),
    ];
    mockGet
      .mockReturnValueOnce(BOOK_A)
      .mockReturnValueOnce(null);
    mockFindMany.mockResolvedValue(logs);
    mockAll.mockReturnValue([]);

    const result = await computeBookDetail(10);
    const statuses = result!.members.map(m => m.status);
    expect(statuses[0]).toBe('finished');
    expect(statuses[1]).toBe('reading');
    expect(statuses[2]).toBe('abandoned');
    expect(statuses[3]).toBe('dnr');
  });
});
