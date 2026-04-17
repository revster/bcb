import scrapeBook from '../../../lib/scrapeBook';

// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockGet = jest.fn();
const mockAll = jest.fn();

jest.mock('../../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    get:     mockGet,
    all:     mockAll,
  };
  return {
    select: jest.fn(() => chain),
    query: {},
  };
});
jest.mock('../../../lib/scrapeBook');
// Bypass auth for route tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('../../../website/middleware/requireAdmin', () => (_req: any, _res: any, next: any) => next());

const express = require('express');
const request = require('supertest');
const apiRoutes = require('../../../website/routes/api');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRoutes);
  return app;
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockAll.mockReturnValue([]);
});
afterEach(() => jest.clearAllMocks());

// ── GET /api/books/scrape ──────────────────────────────────────────────────────

const VALID_URL = 'https://www.goodreads.com/book/show/44767458-dune';
const VALID_URL_2 = 'https://www.goodreads.com/book/show/12345.New_Book';

describe('GET /api/books/scrape', () => {
  test('returns 400 when url param is missing', async () => {
    const res = await request(makeApp()).get('/api/books/scrape');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('returns 400 for a non-Goodreads URL', async () => {
    const res = await request(makeApp()).get('/api/books/scrape?url=https://amazon.com/book/123');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('returns existing book from db with fromDb: true', async () => {
    mockGet.mockReturnValueOnce({ id: 1, title: 'Dune', author: 'Frank Herbert', goodreadsUrl: VALID_URL });
    const res = await request(makeApp()).get(`/api/books/scrape?url=${encodeURIComponent(VALID_URL)}`);
    expect(res.status).toBe(200);
    expect(res.body.fromDb).toBe(true);
    expect(res.body.title).toBe('Dune');
    expect(scrapeBook).not.toHaveBeenCalled();
  });

  test('scrapes and returns book when not in db', async () => {
    mockGet.mockReturnValueOnce(undefined); // not in db
    jest.mocked(scrapeBook).mockResolvedValue({ title: 'New Book', author: 'Author', pages: 300, genres: [] as string[], rating: null, image: null });
    const res = await request(makeApp()).get(`/api/books/scrape?url=${encodeURIComponent(VALID_URL_2)}`);
    expect(res.status).toBe(200);
    expect(res.body.fromDb).toBe(false);
    expect(res.body.title).toBe('New Book');
  });

  test('returns 422 when scraping fails', async () => {
    mockGet.mockReturnValueOnce(undefined); // not in db
    jest.mocked(scrapeBook).mockRejectedValue(new Error('Goodreads returned 404'));
    const res = await request(makeApp()).get(`/api/books/scrape?url=${encodeURIComponent(VALID_URL)}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Goodreads returned 404');
  });
});

// ── GET /api/members ──────────────────────────────────────────────────────────

describe('GET /api/members', () => {
  test('returns merged list sorted by username', async () => {
    // getMembers() calls .all() twice: memberChannels then users
    mockAll
      .mockReturnValueOnce([{ userId: '2', username: 'alice' }])  // memberChannels
      .mockReturnValueOnce([{ userId: '1', username: 'zara' }]);  // users
    const res = await request(makeApp()).get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body[0].username).toBe('alice');
    expect(res.body[1].username).toBe('zara');
  });

  test('User table wins when userId appears in both tables', async () => {
    mockAll
      .mockReturnValueOnce([{ userId: '1', username: 'old-name' }])     // memberChannels
      .mockReturnValueOnce([{ userId: '1', username: 'updated-name' }]); // users (wins)
    const res = await request(makeApp()).get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('updated-name');
  });
});

// ── GET /api/logs ─────────────────────────────────────────────────────────────

describe('GET /api/logs', () => {
  test('returns all logs with book included', async () => {
    mockAll.mockReturnValueOnce([
      { ReadingLog: { id: 1, userId: '1', status: 'finished' }, Book: { title: 'Dune' } },
    ]);
    const res = await request(makeApp()).get('/api/logs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].book.title).toBe('Dune');
  });

  test('returns empty array when no logs exist', async () => {
    mockAll.mockReturnValueOnce([]);
    const res = await request(makeApp()).get('/api/logs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
