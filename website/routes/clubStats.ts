import type { Request, Response } from 'express';
import { computeLeaderboard, computeClubOverview, computeBookDetail } from '../lib/clubStats';

const express      = require('express');
const router       = express.Router();
const requireLogin = require('../middleware/requireLogin');

router.use(requireLogin);

router.get('/leaderboard', async (req: Request, res: Response) => {
  const rawYear   = req.query['year'] as string | undefined;
  const filterYear = rawYear ? parseInt(rawYear, 10) : undefined;
  const data = await computeLeaderboard(isNaN(filterYear as number) ? undefined : filterYear);
  res.render('stats/leaderboard', {
    title:       'Leaderboard',
    appName:     "Hermione's Army",
    filterYear:  isNaN(filterYear as number) ? null : filterYear,
    ...data,
  });
});

router.get('/club', async (_req: Request, res: Response) => {
  const overview = await computeClubOverview();
  res.render('stats/club', {
    title:   'Club Stats',
    appName: "Hermione's Army",
    overview,
  });
});

router.get('/book/:bookId', async (req: Request, res: Response) => {
  const bookId = parseInt(req.params['bookId'] as string, 10);
  if (isNaN(bookId)) return res.status(404).render('error', { title: 'Not Found', message: 'Book not found.' });

  const detail = await computeBookDetail(bookId);
  if (!detail) return res.status(404).render('error', { title: 'Not Found', message: 'Book not found.' });

  res.render('stats/book', {
    title:   detail.book.title,
    appName: "Hermione's Army",
    detail,
  });
});

module.exports = router;
