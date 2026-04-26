const requireLogin = require('../../../website/middleware/requireLogin');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(user: any = null) {
  return { session: user ? { user } : {} as any };
}

function makeRes() {
  return { locals: {} as any, redirect: jest.fn() };
}

afterEach(() => jest.resetAllMocks());

describe('requireLogin middleware', () => {
  test('redirects to /auth/login when session has no user', () => {
    const req  = makeReq();
    const res  = makeRes();
    const next = jest.fn();
    requireLogin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('sets res.locals.user and calls next for any logged-in user', () => {
    const user = { id: '123', username: 'alice', isAdmin: false };
    const req  = makeReq(user);
    const res  = makeRes();
    const next = jest.fn();
    requireLogin(req, res, next);
    expect(res.locals.user).toBe(user);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('allows admin users through as well', () => {
    const user = { id: '456', username: 'admin', isAdmin: true };
    const req  = makeReq(user);
    const res  = makeRes();
    const next = jest.fn();
    requireLogin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
