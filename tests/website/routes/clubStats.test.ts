const mockComputeLeaderboard = jest.fn();
const mockComputeClubOverview = jest.fn();
const mockComputeBookDetail  = jest.fn();

jest.mock('../../../website/lib/clubStats', () => ({
  computeLeaderboard:  mockComputeLeaderboard,
  computeClubOverview: mockComputeClubOverview,
  computeBookDetail:   mockComputeBookDetail,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('../../../website/middleware/requireLogin', () => (req: any, res: any, next: any) => {
  res.locals.user = { id: '111', username: 'alice', globalName: 'Alice', avatar: null, isAdmin: false };
  next();
});

const express          = require('express');
const request          = require('supertest');
const clubStatsRoutes  = require('../../../website/routes/clubStats');

function makeApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((_req: any, res: any, next: any) => {
    res.locals.csrfToken = 'test-csrf';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.render = (view: string, locals: any) => res.json({ _view: view, ...locals });
    next();
  });
  app.use('/', clubStatsRoutes);
  return app;
}

const LEADERBOARD_DATA = {
  rows:  [{ userId: 'u1', displayName: 'Alice', finished: 3, enrolled: 4, rate: 75, avgRating: 4.0 }],
  years: [2023, 2022],
};

const OVERVIEW_DATA = {
  totalFinished: 10,
  uniqueBooksRead: 5,
  activeMembers: 3,
  currentlyReadingCount: 1,
  botmByYear: [],
  mostReadBooks: [],
  topGenres: [],
  currentlyReading: [],
};

const BOOK_DETAIL = {
  book:      { id: 42, title: 'Dune', author: 'Frank Herbert', pages: 412, imageUrl: null, goodreadsUrl: null, genres: '[]' },
  isBotm:    true,
  botmMonth: 6,
  botmYear:  2022,
  members:   [],
  finishers: 0,
  enrolled:  0,
  avgRating: null,
};

afterEach(() => {
  mockComputeLeaderboard.mockReset();
  mockComputeClubOverview.mockReset();
  mockComputeBookDetail.mockReset();
  jest.clearAllMocks();
});

// ── GET /leaderboard ──────────────────────────────────────────────────────────

describe('GET /leaderboard', () => {
  test('renders stats/leaderboard view', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    const res = await request(makeApp()).get('/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('stats/leaderboard');
  });

  test('passes rows and years to view', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    const res = await request(makeApp()).get('/leaderboard');
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.years).toEqual([2023, 2022]);
  });

  test('calls computeLeaderboard with no year when ?year is absent', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    await request(makeApp()).get('/leaderboard');
    expect(mockComputeLeaderboard).toHaveBeenCalledWith(undefined);
  });

  test('passes parsed year to computeLeaderboard from ?year query param', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    await request(makeApp()).get('/leaderboard?year=2022');
    expect(mockComputeLeaderboard).toHaveBeenCalledWith(2022);
  });

  test('ignores non-numeric ?year and calls with undefined', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    await request(makeApp()).get('/leaderboard?year=abc');
    expect(mockComputeLeaderboard).toHaveBeenCalledWith(undefined);
  });

  test('passes filterYear=null to view when no year param', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    const res = await request(makeApp()).get('/leaderboard');
    expect(res.body.filterYear).toBeNull();
  });

  test('passes filterYear to view when valid year param given', async () => {
    mockComputeLeaderboard.mockResolvedValue(LEADERBOARD_DATA);
    const res = await request(makeApp()).get('/leaderboard?year=2023');
    expect(res.body.filterYear).toBe(2023);
  });
});

// ── GET /club ─────────────────────────────────────────────────────────────────

describe('GET /club', () => {
  test('renders stats/club view', async () => {
    mockComputeClubOverview.mockResolvedValue(OVERVIEW_DATA);
    const res = await request(makeApp()).get('/club');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('stats/club');
  });

  test('passes overview data to view', async () => {
    mockComputeClubOverview.mockResolvedValue(OVERVIEW_DATA);
    const res = await request(makeApp()).get('/club');
    expect(res.body.overview.totalFinished).toBe(10);
    expect(res.body.overview.activeMembers).toBe(3);
  });

  test('calls computeClubOverview once', async () => {
    mockComputeClubOverview.mockResolvedValue(OVERVIEW_DATA);
    await request(makeApp()).get('/club');
    expect(mockComputeClubOverview).toHaveBeenCalledTimes(1);
  });
});

// ── GET /book/:bookId ─────────────────────────────────────────────────────────

describe('GET /book/:bookId', () => {
  test('renders stats/book view with detail', async () => {
    mockComputeBookDetail.mockResolvedValue(BOOK_DETAIL);
    const res = await request(makeApp()).get('/book/42');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('stats/book');
    expect(res.body.detail.book.title).toBe('Dune');
  });

  test('calls computeBookDetail with parsed bookId', async () => {
    mockComputeBookDetail.mockResolvedValue(BOOK_DETAIL);
    await request(makeApp()).get('/book/42');
    expect(mockComputeBookDetail).toHaveBeenCalledWith(42);
  });

  test('returns 404 when bookId is not a number', async () => {
    const res = await request(makeApp()).get('/book/abc');
    expect(res.status).toBe(404);
    expect(mockComputeBookDetail).not.toHaveBeenCalled();
  });

  test('returns 404 when computeBookDetail returns null', async () => {
    mockComputeBookDetail.mockResolvedValue(null);
    const res = await request(makeApp()).get('/book/999');
    expect(res.status).toBe(404);
  });

  test('uses book title as page title', async () => {
    mockComputeBookDetail.mockResolvedValue(BOOK_DETAIL);
    const res = await request(makeApp()).get('/book/42');
    expect(res.body.title).toBe('Dune');
  });
});
