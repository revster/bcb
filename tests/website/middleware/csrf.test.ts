const csrf = require('../../../website/middleware/csrf');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq({ method = 'GET', path = '/test', session = {} as any, body = {}, headers = {} } = {}) {
  return { method, path, session, body, headers };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRes(): any {
  const res: any = { locals: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.render = jest.fn();
  return res;
}

afterEach(() => jest.resetAllMocks());

describe('csrf middleware', () => {
  test('generates a token when session has none', () => {
    const req = makeReq({ session: {} });
    const res = makeRes();
    csrf(req, res, jest.fn());
    expect(req.session.csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reuses an existing session token', () => {
    const req = makeReq({ session: { csrfToken: 'existing' } });
    const res = makeRes();
    csrf(req, res, jest.fn());
    expect(req.session.csrfToken).toBe('existing');
  });

  test('sets res.locals.csrfToken from session', () => {
    const req = makeReq({ session: {} });
    const res = makeRes();
    csrf(req, res, jest.fn());
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
  });

  test('calls next without validation on GET', () => {
    const req = makeReq({ method: 'GET', session: {} });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next without validation on HEAD', () => {
    const req = makeReq({ method: 'HEAD', session: {} });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next without validation on OPTIONS', () => {
    const req = makeReq({ method: 'OPTIONS', session: {} });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips validation for /auth/discord/callback', () => {
    const req = makeReq({ method: 'POST', path: '/auth/discord/callback', session: { csrfToken: 'secret' } });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 when token is absent', () => {
    const req = makeReq({ method: 'POST', session: { csrfToken: 'secret' }, body: {}, headers: {} });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('error', expect.objectContaining({ title: 'Forbidden' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when body token does not match', () => {
    const req = makeReq({ method: 'POST', session: { csrfToken: 'secret' }, body: { _csrf: 'wrong' } });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next when body token matches', () => {
    const req = makeReq({ method: 'POST', session: { csrfToken: 'secret' }, body: { _csrf: 'secret' } });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('accepts token from x-csrf-token header', () => {
    const req = makeReq({
      method: 'POST',
      session: { csrfToken: 'secret' },
      body: {},
      headers: { 'x-csrf-token': 'secret' },
    });
    const res = makeRes();
    const next = jest.fn();
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
