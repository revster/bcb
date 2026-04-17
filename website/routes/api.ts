/**
 * JSON API routes — used by the admin HTML pages today,
 * ready for a React frontend to consume in the future.
 * All routes require admin authentication.
 */

const express = require('express');
const router = express.Router();
import { eq, desc } from 'drizzle-orm';
const db = require('../../db');
import { books, readingLogs, users, memberChannels } from '../../schema';
import scrapeBook from '../../lib/scrapeBook';
const requireAdmin = require('../middleware/requireAdmin');

router.use(requireAdmin);

// Scrape a Goodreads URL and return book metadata (or existing DB record)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;

router.get('/books/scrape', async (req: any, res: any) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });
  if (!GOODREADS_BOOK_RE.test(url as string))
    return res.status(400).json({ error: 'url must be a Goodreads book URL' });

  try {
    // Return existing book if already in DB
    const existing = db.select().from(books).where(eq(books.goodreadsUrl, url as string)).get();
    if (existing) return res.json({ ...existing, fromDb: true });

    const scraped = await scrapeBook(url);
    res.json({ ...scraped, fromDb: false });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
});

// List all known members (merged User + MemberChannel)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/members', (_req: any, res: any) => {
  const map = new Map<string, { userId: string; username: string }>();
  for (const m of db.select({ userId: memberChannels.userId, username: memberChannels.username }).from(memberChannels).all())
    map.set(m.userId, m);
  for (const u of db.select({ userId: users.userId, username: users.username }).from(users).all())
    map.set(u.userId, u);
  res.json([...map.values()].sort((a: any, b: any) => a.username.localeCompare(b.username)));
});

// List reading logs (JSON)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs', (_req: any, res: any) => {
  const logs = db.select().from(readingLogs)
    .leftJoin(books, eq(readingLogs.bookId, books.id))
    .orderBy(desc(readingLogs.startedAt))
    .all()
    .map((row: any) => ({ ...row.ReadingLog, book: row.Book }));
  res.json(logs);
});

module.exports = router;
