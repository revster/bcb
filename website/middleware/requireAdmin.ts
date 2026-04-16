import type { Response, NextFunction } from 'express';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = function requireAdmin(req: Request & { session: any }, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.redirect('/auth/login');
  }
  res.locals.user = req.session.user;
  next();
};
