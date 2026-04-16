import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// OAuth callback comes from Discord — no session token to check
const SKIP_PATHS = new Set(['/auth/discord/callback']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = function csrf(req: Request & { session: any }, res: Response, next: NextFunction) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method) || SKIP_PATHS.has(req.path)) {
    return next();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (req.body as any)?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Invalid CSRF token. Go back and try again.',
    });
  }
  next();
};
