/**
 * JSON API routes — used by the admin HTML pages today,
 * ready for a React frontend to consume in the future.
 * All routes require admin authentication.
 */

const express = require('express');
const router = express.Router();
const db = require('../../db');
const scrapeBook = require('../../lib/scrapeBook');
const requireAdmin = require('../middleware/requireAdmin');

router.use(requireAdmin);

// Scrape a Goodreads URL and return book metadata (or existing DB record)
router.get('/books/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    // Return existing book if already in DB
    const existing = await db.book.findUnique({ where: { goodreadsUrl: url } });
    if (existing) return res.json({ ...existing, fromDb: true });

    const scraped = await scrapeBook(url);
    res.json({ ...scraped, fromDb: false });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// List all known members (merged User + MemberChannel)
router.get('/members', async (req, res) => {
  const [users, members] = await Promise.all([
    db.user.findMany(),
    db.memberChannel.findMany(),
  ]);
  const map = new Map();
  for (const m of members) map.set(m.userId, { userId: m.userId, username: m.username });
  for (const u of users)   map.set(u.userId, { userId: u.userId, username: u.username });
  res.json([...map.values()].sort((a, b) => a.username.localeCompare(b.username)));
});

// List reading logs (JSON)
router.get('/logs', async (req, res) => {
  const logs = await db.readingLog.findMany({
    include:  { book: true },
    orderBy:  { startedAt: 'desc' },
  });
  res.json(logs);
});

module.exports = router;
