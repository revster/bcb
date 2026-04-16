import scrapeBook from '../../../lib/scrapeBook';
jest.mock('../../../db', () => ({
  book:        { findUnique: jest.fn() },
  user:        { findMany: jest.fn() },
  memberChannel: { findMany: jest.fn() },
  readingLog:  { findMany: jest.fn() },
}));
jest.mock('../../../lib/scrapeBook');
// Bypass auth for route tests
jest.mock('../../../website/middleware/requireAdmin', () => (_req, _res, next) => next());

const express = require('express');
const request = require('supertest');
const db          = require('../../../db');
const apiRoutes   = require('../../../website/routes/api');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRoutes);
  return app;
}

afterEach(() => jest.resetAllMocks());

// ── GET /api/books/scrape ──────────────────────────────────────────────────────

describe('GET /api/books/scrape', () => {
  test('returns 400 when url param is missing', async () => {
    const res = await request(makeApp()).get('/api/books/scrape');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('returns existing book from db with fromDb: true', async () => {
    db.book.findUnique.mockResolvedValue({ id: 1, title: 'Dune', author: 'Frank Herbert', goodreadsUrl: 'http://gr.com/1' });
    const res = await request(makeApp()).get('/api/books/scrape?url=http://gr.com/1');
    expect(res.status).toBe(200);
    expect(res.body.fromDb).toBe(true);
    expect(res.body.title).toBe('Dune');
    expect(scrapeBook).not.toHaveBeenCalled();
  });

  test('scrapes and returns book when not in db', async () => {
    db.book.findUnique.mockResolvedValue(null);
    jest.mocked(scrapeBook).mockResolvedValue({ title: 'New Book', author: 'Author', pages: 300, genres: [] });
    const res = await request(makeApp()).get('/api/books/scrape?url=http://gr.com/2');
    expect(res.status).toBe(200);
    expect(res.body.fromDb).toBe(false);
    expect(res.body.title).toBe('New Book');
  });

  test('returns 422 when scraping fails', async () => {
    db.book.findUnique.mockResolvedValue(null);
    jest.mocked(scrapeBook).mockRejectedValue(new Error('Goodreads returned 404'));
    const res = await request(makeApp()).get('/api/books/scrape?url=http://gr.com/bad');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Goodreads returned 404');
  });
});

// ── GET /api/members ──────────────────────────────────────────────────────────

describe('GET /api/members', () => {
  test('returns merged list sorted by username', async () => {
    db.user.findMany.mockResolvedValue([{ userId: '1', username: 'zara' }]);
    db.memberChannel.findMany.mockResolvedValue([{ userId: '2', username: 'alice' }]);
    const res = await request(makeApp()).get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body[0].username).toBe('alice');
    expect(res.body[1].username).toBe('zara');
  });

  test('User table wins when userId appears in both tables', async () => {
    db.user.findMany.mockResolvedValue([{ userId: '1', username: 'updated-name' }]);
    db.memberChannel.findMany.mockResolvedValue([{ userId: '1', username: 'old-name' }]);
    const res = await request(makeApp()).get('/api/members');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('updated-name');
  });
});

// ── GET /api/logs ─────────────────────────────────────────────────────────────

describe('GET /api/logs', () => {
  test('returns all logs with book included', async () => {
    db.readingLog.findMany.mockResolvedValue([
      { id: 1, userId: '1', status: 'finished', book: { title: 'Dune' } },
    ]);
    const res = await request(makeApp()).get('/api/logs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].book.title).toBe('Dune');
  });

  test('returns empty array when no logs exist', async () => {
    db.readingLog.findMany.mockResolvedValue([]);
    const res = await request(makeApp()).get('/api/logs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
