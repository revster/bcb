/**
 * JSON API routes — used by the admin HTML pages today,
 * ready for a React frontend to consume in the future.
 * All routes require admin authentication.
 */

const express = require('express');
const router = express.Router();
const db = require('../../db');
import scrapeBook from '../../lib/scrapeBook';
const requireAdmin = require('../middleware/requireAdmin');

router.use(requireAdmin);

// Scrape a Goodreads URL and return book metadata (or existing DB record)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/books/scrape', async (req: any, res: any) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    // Return existing book if already in DB
    const existing = await db.book.findUnique({ where: { goodreadsUrl: url } });
    if (existing) return res.json({ ...existing, fromDb: true });

    const scraped = await scrapeBook(url);
    res.json({ ...scraped, fromDb: false });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
});

// List all known members (merged User + MemberChannel)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/members', async (_req: any, res: any) => {
  const [users, members] = await Promise.all([
    db.user.findMany(),
    db.memberChannel.findMany(),
  ]);
  const map = new Map<string, { userId: string; username: string }>();
  for (const m of members) map.set(m.userId, { userId: m.userId, username: m.username });
  for (const u of users)   map.set(u.userId, { userId: u.userId, username: u.username });
  res.json([...map.values()].sort((a, b) => a.username.localeCompare(b.username)));
});

// List reading logs (JSON)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs', async (_req: any, res: any) => {
  const logs = await db.readingLog.findMany({
    include:  { book: true },
    orderBy:  { startedAt: 'desc' },
  });
  res.json(logs);
});

module.exports = router;
