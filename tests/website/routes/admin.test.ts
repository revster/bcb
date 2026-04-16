jest.mock('../../../db', () => ({
  readingLog:    { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  book:          { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  user:          { findMany: jest.fn(), count: jest.fn() },
  memberChannel: { findMany: jest.fn() },
  clubBook:      { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
  reminderQuip:  { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../lib/scrapeBook');

const express    = require('express');
const request    = require('supertest');
const db         = require('../../../db');
const scrapeBook = require('../../../lib/scrapeBook');
const adminRoutes = require('../../../website/routes/admin');

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
    // Return the view name as JSON so tests can assert on it
    res.render = (view: any, _locals: any) => res.json({ _view: view });
    next();
  });
  app.use('/', adminRoutes);
  return app;
}

// Default empty stubs for getMembers() used by several routes
function stubMembers() {
  db.user.findMany.mockResolvedValue([]);
  db.memberChannel.findMany.mockResolvedValue([]);
}

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
afterAll(() => (console.error as any).mockRestore());
afterEach(() => jest.resetAllMocks());

// ── GET / (dashboard) ─────────────────────────────────────────────────────────

describe('GET /', () => {
  test('renders dashboard with stat counts', async () => {
    db.readingLog.count.mockResolvedValue(42);
    db.book.count.mockResolvedValue(15);
    db.user.count.mockResolvedValue(8);
    db.clubBook.count.mockResolvedValue(3);
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/dashboard');
  });
});

// ── GET /logs ─────────────────────────────────────────────────────────────────

describe('GET /logs', () => {
  beforeEach(() => {
    stubMembers();
    db.readingLog.findMany.mockResolvedValue([]);
    db.clubBook.findMany.mockResolvedValue([]);
  });

  test('renders logs view', async () => {
    const res = await request(makeApp()).get('/logs');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/logs');
  });

  test('filters by member when query param is provided', async () => {
    await request(makeApp()).get('/logs?member=user-123');
    expect(db.readingLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-123' } })
    );
  });

  test('filters by status when query param is provided', async () => {
    await request(makeApp()).get('/logs?status=finished');
    expect(db.readingLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'finished' } })
    );
  });

  test('applies both filters together', async () => {
    await request(makeApp()).get('/logs?member=user-123&status=reading');
    expect(db.readingLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-123', status: 'reading' } })
    );
  });
});

// ── GET /logs/new ─────────────────────────────────────────────────────────────

describe('GET /logs/new', () => {
  test('renders log-form in create mode', async () => {
    stubMembers();
    const res = await request(makeApp()).get('/logs/new');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });
});

// ── POST /logs (create) ───────────────────────────────────────────────────────

describe('POST /logs', () => {
  beforeEach(stubMembers);

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
    db.book.findUnique.mockResolvedValue({ id: 1 });
    db.readingLog.create.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
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
    stubMembers();
    db.readingLog.findUnique.mockResolvedValue({ id: 1, bookId: 10, book: { title: 'Dune' } });
    db.clubBook.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/logs/1/edit');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('returns 404 when log does not exist', async () => {
    db.readingLog.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/logs/999/edit');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});

// ── POST /logs/:id (update) ───────────────────────────────────────────────────

describe('POST /logs/:id', () => {
  beforeEach(stubMembers);

  test('updates log and redirects on success', async () => {
    const log = { id: 1, bookId: 10, startedAt: new Date(), book: { title: 'Dune' } };
    db.readingLog.findUnique.mockResolvedValue(log);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const res = await request(makeApp())
      .post('/logs/1')
      .send({ status: 'finished' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/logs?updated=1');
  });

  test('re-renders form on invalid status', async () => {
    const log = { id: 1, bookId: 10, startedAt: new Date(), book: { title: 'Dune' } };
    db.readingLog.findUnique.mockResolvedValue(log);
    db.clubBook.findUnique.mockResolvedValue(null);
    const res = await request(makeApp())
      .post('/logs/1')
      .send({ status: 'invalid' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/log-form');
  });

  test('returns 404 when log does not exist', async () => {
    db.readingLog.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).post('/logs/999').send({ status: 'finished' });
    expect(res.status).toBe(404);
  });
});

// ── GET /quips ────────────────────────────────────────────────────────────────

describe('GET /quips', () => {
  test('renders quips view', async () => {
    db.reminderQuip.findMany.mockResolvedValue([]);
    const res = await request(makeApp()).get('/quips');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/quips');
  });
});

// ── POST /quips ───────────────────────────────────────────────────────────────

describe('POST /quips', () => {
  test('creates quip and redirects on success', async () => {
    db.reminderQuip.findMany.mockResolvedValue([]);
    db.reminderQuip.create.mockResolvedValue({});
    const res = await request(makeApp()).post('/quips').send({ text: 'Read your book!' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/quips?created=1');
  });

  test('re-renders form when text is empty', async () => {
    db.reminderQuip.findMany.mockResolvedValue([]);
    const res = await request(makeApp()).post('/quips').send({ text: '' });
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('admin/quips');
  });
});

// ── POST /quips/:id/delete ────────────────────────────────────────────────────

describe('POST /quips/:id/delete', () => {
  test('deletes quip and redirects on success', async () => {
    db.reminderQuip.delete.mockResolvedValue({});
    const res = await request(makeApp()).post('/quips/1/delete');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/quips?deleted=1');
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(makeApp()).post('/quips/abc/delete');
    expect(res.status).toBe(400);
    expect(res.body._view).toBe('error');
  });

  test('returns 404 when quip does not exist (Prisma P2025)', async () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    db.reminderQuip.delete.mockRejectedValue(err);
    const res = await request(makeApp()).post('/quips/999/delete');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});

// ── POST /logs/:id/delete ─────────────────────────────────────────────────────

describe('POST /logs/:id/delete', () => {
  test('deletes log and redirects on success', async () => {
    db.readingLog.delete.mockResolvedValue({});
    const res = await request(makeApp()).post('/logs/1/delete');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/logs?deleted=1');
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(makeApp()).post('/logs/abc/delete');
    expect(res.status).toBe(400);
    expect(res.body._view).toBe('error');
  });

  test('returns 404 when log does not exist (Prisma P2025)', async () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    db.readingLog.delete.mockRejectedValue(err);
    const res = await request(makeApp()).post('/logs/999/delete');
    expect(res.status).toBe(404);
    expect(res.body._view).toBe('error');
  });
});
