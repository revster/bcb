const mockComputeUserStats = jest.fn();

jest.mock('../../../website/lib/userStats', () => ({
  computeUserStats: mockComputeUserStats,
}));

// Bypass auth — sets a regular (non-admin) user on res.locals
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('../../../website/middleware/requireLogin', () => (req: any, res: any, next: any) => {
  res.locals.user = { id: '111', username: 'alice', globalName: 'Alice', avatar: null, isAdmin: false };
  (req as any).session = { user: res.locals.user };
  next();
});

const express    = require('express');
const request    = require('supertest');
const userRoutes = require('../../../website/routes/user');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((_req: any, res: any, next: any) => {
    res.locals.csrfToken = 'test-csrf';
    // Override res.render so we can inspect without EJS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.render = (view: string, locals: any) => res.json({ _view: view, ...locals });
    next();
  });
  app.use('/', userRoutes);
  return app;
}

beforeEach(() => {
  mockComputeUserStats.mockResolvedValue(null);
});
afterEach(() => { mockComputeUserStats.mockReset(); jest.clearAllMocks(); });

// ── GET /me ───────────────────────────────────────────────────────────────────

describe('GET /me', () => {
  test('renders user/stats view', async () => {
    const res = await request(makeApp()).get('/me');
    expect(res.status).toBe(200);
    expect(res.body._view).toBe('user/stats');
  });

  test('passes stats=null to view when user has no reading history', async () => {
    mockComputeUserStats.mockResolvedValue(null);
    const res = await request(makeApp()).get('/me');
    expect(res.body.stats).toBeNull();
  });

  test('passes stats object to view when user has reading history', async () => {
    mockComputeUserStats.mockResolvedValue({
      allFinished: [{ bookId: 1, status: 'finished', book: { title: 'Dune' } }],
      hasBotm: false,
    });
    const res = await request(makeApp()).get('/me');
    expect(res.body.stats).not.toBeNull();
    expect(res.body.stats.allFinished).toHaveLength(1);
  });

  test('calls computeUserStats with the logged-in user id', async () => {
    await request(makeApp()).get('/me');
    expect(mockComputeUserStats).toHaveBeenCalledWith('111');
  });

  test('passes a default avatar URL when user has no avatar hash', async () => {
    const res = await request(makeApp()).get('/me');
    expect(res.body.avatarUrl).toMatch(/cdn\.discordapp\.com\/embed\/avatars/);
  });
});
