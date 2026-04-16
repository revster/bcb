// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockGet = jest.fn();
const mockAll = jest.fn();
const mockRun = jest.fn();
const mockQueryFindFirst = jest.fn();

jest.mock('../../../db', () => {
  const chain: any = {
    from:               jest.fn().mockReturnThis(),
    where:              jest.fn().mockReturnThis(),
    orderBy:            jest.fn().mockReturnThis(),
    leftJoin:           jest.fn().mockReturnThis(),
    values:             jest.fn().mockReturnThis(),
    set:                jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    returning:          jest.fn().mockReturnThis(),
    get:                mockGet,
    all:                mockAll,
    run:                mockRun,
  };
  return {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    query: {
      readingLogs: { findFirst: mockQueryFindFirst },
    },
  };
});
jest.mock('../../../lib/scrapeBook');

const express      = require('express');
const request      = require('supertest');
const db           = require('../../../db');
const adminRoutes  = require('../../../website/routes/admin');

// Minimal test app: bypasses auth/csrf, overrides res.render so we can
// inspect which view and status code would be sent without needing EJS.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((_req: any, res: any, next: any) => {
    res.locals.user      = { id: '999', username: 'testadmin' };
    res.locals.csrfToken = 'test-csrf';
    res.render = (view: any, _locals: any) => res.json({ _view: view });
    next();
  });
  app.use('/', adminRoutes);
  return app;
}

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
afterAll(() => (console.error as any).mockRestore());

beforeEach(() => {
  // Default: db.select().get() returns { c: 0 } (safe for count() calls),
  // .all() returns [], .run() returns { changes: 1 }
  mockGet.mockReturnValue({ c: 0 });
  mockAll.mockReturnValue([]);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => jest.clearAllMocks());

// ── GET / (dashboard) ─────────────────────────────────────────────────────────

describe('GET /', () => {
  test('renders dashboard with stat counts', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/dashboard');
  });
});

// ── GET /logs ─────────────────────────────────────────────────────────────────

describe('GET /logs', () => {
  test('renders logs view', async () => {
    const res = await request(makeApp()).get('/logs');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/logs');
  });

  test('renders logs view with member filter', async () => {
    const res = await request(makeApp()).get('/logs?member=user-123');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/logs');
  });

  test('renders logs view with status filter', async () => {
    const res = await request(makeApp()).get('/logs?status=finished');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/logs');
  });

  test('renders logs view with both filters', async () => {
    const res = await request(makeApp()).get('/logs?member=user-123&status=reading');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/logs');
  });
});

// ── GET /logs/new ─────────────────────────────────────────────────────────────

describe('GET /logs/new', () => {
  test('renders log-form in create mode', async () => {
    const res = await request(makeApp()).get('/logs/new');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });
});

// ── POST /logs (create) ───────────────────────────────────────────────────────

describe('POST /logs', () => {
  test('re-renders form when required fields are missing', async () => {
    const res = await request(makeApp()).post('/logs').send({ status: 'finished' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('re-renders form on invalid status', async () => {
    const res = await request(makeApp())
      .post('/logs')
      .send({ goodreadsUrl: 'http://gr.com/1', userId: 'user-1', status: 'invalid' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('creates log and redirects on success', async () => {
    // First .get() call: book lookup → found (truthy, has .id)
    mockGet.mockReturnValueOnce({ id: 1, title: 'Dune', goodreadsUrl: 'http://gr.com/1' });
    const res = await request(makeApp())
      .post('/logs')
      .send({ goodreadsUrl: 'http://gr.com/1', userId: 'user-1', status: 'finished' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/logs?created=1');
  });
});

// ── GET /logs/:id/edit ────────────────────────────────────────────────────────

describe('GET /logs/:id/edit', () => {
  test('renders log-form in edit mode', async () => {
    mockQueryFindFirst.mockResolvedValue({ id: 1, bookId: 10, book: { title: 'Dune' } });
    const res = await request(makeApp()).get('/logs/1/edit');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('returns 404 when log does not exist', async () => {
    mockQueryFindFirst.mockResolvedValue(undefined);
    const res = await request(makeApp()).get('/logs/999/edit');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});

// ── POST /logs/:id (update) ───────────────────────────────────────────────────

describe('POST /logs/:id', () => {
  test('updates log and redirects on success', async () => {
    const log = { id: 1, bookId: 10, startedAt: new Date(), book: { title: 'Dune' } };
    mockQueryFindFirst.mockResolvedValue(log);
    const res = await request(makeApp())
      .post('/logs/1')
      .send({ status: 'finished' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/logs?updated=1');
  });

  test('re-renders form on invalid status', async () => {
    const log = { id: 1, bookId: 10, startedAt: new Date(), book: { title: 'Dune' } };
    mockQueryFindFirst.mockResolvedValue(log);
    const res = await request(makeApp())
      .post('/logs/1')
      .send({ status: 'invalid' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('returns 404 when log does not exist', async () => {
    mockQueryFindFirst.mockResolvedValue(undefined);
    const res = await request(makeApp()).post('/logs/999').send({ status: 'finished' });
    expect(res.status).toBe(404);
  });
});

// ── GET /quips ────────────────────────────────────────────────────────────────

describe('GET /quips', () => {
  test('renders quips view', async () => {
    const res = await request(makeApp()).get('/quips');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/quips');
  });
});

// ── POST /quips ───────────────────────────────────────────────────────────────

describe('POST /quips', () => {
  test('creates quip and redirects on success', async () => {
    const res = await request(makeApp()).post('/quips').send({ text: 'Read your book!' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/quips?created=1');
  });

  test('re-renders form when text is empty', async () => {
    const res = await request(makeApp()).post('/quips').send({ text: '' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/quips');
  });
});

// ── POST /quips/:id/delete ────────────────────────────────────────────────────

describe('POST /quips/:id/delete', () => {
  test('deletes quip and redirects on success', async () => {
    const res = await request(makeApp()).post('/quips/1/delete');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/quips?deleted=1');
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(makeApp()).post('/quips/abc/delete');
    expect(res.status).toBe(400);
    expect(res.body._view).toBe('error');
  });

  test('returns 404 when quip does not exist', async () => {
    mockRun.mockReturnValueOnce({ changes: 0 });
    const res = await request(makeApp()).post('/quips/999/delete');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});

// ── POST /logs/:id/delete ─────────────────────────────────────────────────────

describe('POST /logs/:id/delete', () => {
  test('deletes log and redirects on success', async () => {
    const res = await request(makeApp()).post('/logs/1/delete');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/logs?deleted=1');
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(makeApp()).post('/logs/abc/delete');
    expect(res.status).toBe(400);
    expect(res.body._view).toBe('error');
  });

  test('returns 404 when log does not exist', async () => {
    mockRun.mockReturnValueOnce({ changes: 0 });
    const res = await request(makeApp()).post('/logs/999/delete');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});
