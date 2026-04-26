const requireAdmin = require('../../../website/middleware/requireAdmin');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(user: any = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { session: user ? { user } : {} as any };
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { locals: {} as any, redirect: jest.fn() };
}

afterEach(() => jest.resetAllMocks());

describe('requireAdmin middleware', () => {
  test('redirects to /auth/login when session has no user', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects to /auth/login?error=not_admin when user lacks admin role', () => {
    const user = { id: '123', username: 'member', isAdmin: false };
    const req = makeReq(user);
    const res = makeRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/auth/login?error=not_admin');
    expect(next).not.toHaveBeenCalled();
  });

  test('sets res.locals.user and calls next when user has admin role', () => {
    const user = { id: '123', username: 'admin', isAdmin: true };
    const req = makeReq(user);
    const res = makeRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.locals.user).toBe(user);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
