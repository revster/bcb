const express = require('express');
const router = express.Router();
const db = require('../../db');
import scrapeBook from '../../lib/scrapeBook';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['reading', 'finished', 'abandoned']);

async function getMembers() {
  const [users, members] = await Promise.all([
    db.user.findMany(),
    db.memberChannel.findMany(),
  ]);
  const map = new Map<string, { userId: string; username: string }>();
  for (const m of members) map.set(m.userId, { userId: m.userId, username: m.username });
  for (const u of users)   map.set(u.userId, { userId: u.userId, username: u.username });
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username));
}

function toDate(str: string | undefined): Date | null {
  return str ? new Date(str) : null;
}

function parseOptionalFloat(str: string | undefined): number | null {
  const n = parseFloat(str ?? '');
  return isNaN(n) ? null : n;
}

function parseOptionalInt(str: string | undefined): number | null {
  const n = parseInt(str ?? '', 10);
  return isNaN(n) ? null : n;
}

async function upsertClubBook(bookId: number, month: number | null, year: number | null) {
  await db.clubBook.upsert({
    where:  { bookId },
    create: { bookId, month, year },
    update: { month, year },
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/', async (req: any, res: any) => {
  const [logCount, bookCount, memberCount, clubBookCount] = await Promise.all([
    db.readingLog.count(),
    db.book.count(),
    db.user.count(),
    db.clubBook.count(),
  ]);
  res.render('admin/dashboard', { logCount, bookCount, memberCount, clubBookCount });
});

// ── Reading Logs ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs', async (req: any, res: any) => {
  const { member: filterMember, status: filterStatus } = req.query;

  const where: Record<string, unknown> = {};
  if (filterMember) where.userId = filterMember;
  if (filterStatus) where.status = filterStatus;

  const [logs, clubBooks, members] = await Promise.all([
    db.readingLog.findMany({
      where,
      include: { book: true },
      orderBy: { startedAt: 'desc' },
    }),
    db.clubBook.findMany({ select: { bookId: true, month: true, year: true } }),
    getMembers(),
  ]);

  const userIds = [...new Set(logs.map((l: { userId: string }) => l.userId))];
  const [users, memberChannels] = await Promise.all([
    db.user.findMany({ where: { userId: { in: userIds } } }),
    db.memberChannel.findMany({ where: { userId: { in: userIds } } }),
  ]);
  const nameMap: Record<string, string> = {};
  for (const m of memberChannels) nameMap[m.userId] = m.username;
  for (const u of users)          nameMap[u.userId] = u.username;

  const clubBookMap = new Map(clubBooks.map((cb: { bookId: number }) => [cb.bookId, cb]));

  const flash = req.query.created  ? 'Log created.'
              : req.query.updated  ? 'Log updated.'
              : req.query.deleted  ? 'Log deleted.'
              : null;

  res.render('admin/logs', {
    logs,
    nameMap,
    clubBookMap,
    members,
    filterMember: filterMember || '',
    filterStatus: filterStatus || '',
    flash,
  });
});

// ── New Log ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs/new', async (_req: any, res: any) => {
  res.render('admin/log-form', {
    mode:     'create',
    log:      null,
    book:     null,
    clubBook: null,
    members:  await getMembers(),
    values:   {},
    error:    null,
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/logs', async (req: any, res: any) => {
  const { goodreadsUrl, userId, status, rating, startedAt, finishedAt, isBotm, botmMonth, botmYear } = req.body;

  try {
    if (!goodreadsUrl || !userId || !status) throw new Error('Goodreads URL, member, and status are required.');
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid status.');

    let book = await db.book.findUnique({ where: { goodreadsUrl } });
    if (!book) {
      const scraped = await scrapeBook(goodreadsUrl);
      book = await db.book.create({
        data: {
          title:        scraped.title,
          author:       scraped.author,
          goodreadsUrl,
          image:        scraped.image,
          pages:        scraped.pages,
          rating:       scraped.rating,
          genres:       JSON.stringify(scraped.genres),
        },
      });
    }

    await db.readingLog.create({
      data: {
        userId,
        bookId:     book.id,
        threadId:   null,
        status,
        rating:     parseOptionalFloat(rating),
        startedAt:  toDate(startedAt) ?? new Date(),
        finishedAt: toDate(finishedAt),
      },
    });

    if (isBotm === 'on') {
      await upsertClubBook(book.id, parseOptionalInt(botmMonth), parseOptionalInt(botmYear));
    }

    res.redirect('/admin/logs?created=1');
  } catch (err) {
    console.error('Create log error:', err);
    res.render('admin/log-form', {
      mode:     'create',
      log:      null,
      book:     null,
      clubBook: null,
      members:  await getMembers(),
      values:   req.body,
      error:    (err as Error).message,
    });
  }
});

// ── Edit Log ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs/:id/edit', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  const log = await db.readingLog.findUnique({
    where:   { id },
    include: { book: true },
  });
  if (!log) return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });

  const clubBook = await db.clubBook.findUnique({ where: { bookId: log.bookId } });

  res.render('admin/log-form', {
    mode:     'edit',
    log,
    book:     log.book,
    clubBook,
    members:  await getMembers(),
    values:   {},
    error:    null,
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/logs/:id', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  const { status, rating, startedAt, finishedAt, isBotm, botmMonth, botmYear } = req.body;

  const log = await db.readingLog.findUnique({
    where:   { id },
    include: { book: true },
  });
  if (!log) return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });

  try {
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid status.');

    await db.readingLog.update({
      where: { id },
      data: {
        status,
        rating:     parseOptionalFloat(rating),
        startedAt:  toDate(startedAt) ?? log.startedAt,
        finishedAt: toDate(finishedAt),
      },
    });

    const existingClubBook = await db.clubBook.findUnique({ where: { bookId: log.bookId } });

    if (isBotm === 'on') {
      await upsertClubBook(log.bookId, parseOptionalInt(botmMonth), parseOptionalInt(botmYear));
    } else if (existingClubBook) {
      // Only remove if there are no Discord channel messages tied to it (i.e. manually entered)
      if (!existingClubBook.progressMessageId) {
        await db.clubBook.delete({ where: { bookId: log.bookId } });
      }
      // If there ARE Discord messages, leave it — removing it would break the bot's #progress post
    }

    res.redirect('/admin/logs?updated=1');
  } catch (err) {
    console.error('Update log error:', err);
    const clubBook = await db.clubBook.findUnique({ where: { bookId: log.bookId } });
    res.render('admin/log-form', {
      mode:     'edit',
      log,
      book:     log.book,
      clubBook,
      members:  await getMembers(),
      values:   req.body,
      error:    (err as Error).message,
    });
  }
});

// ── Reminder Quips ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/quips', async (req: any, res: any) => {
  const quips = await db.reminderQuip.findMany({ orderBy: { createdAt: 'asc' } });
  const flash = req.query.created ? 'Quip added.'
              : req.query.deleted ? 'Quip deleted.'
              : null;
  res.render('admin/quips', { quips, flash, error: null });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/quips', async (req: any, res: any) => {
  const { text } = req.body;
  const quips = await db.reminderQuip.findMany({ orderBy: { createdAt: 'asc' } });
  try {
    if (!text || !text.trim()) throw new Error('Quip text is required.');
    await db.reminderQuip.create({ data: { text: text.trim() } });
    res.redirect('/admin/quips?created=1');
  } catch (err) {
    res.render('admin/quips', { quips, flash: null, error: (err as Error).message });
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/quips/:id/delete', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid quip ID.' });
  try {
    await db.reminderQuip.delete({ where: { id } });
    res.redirect('/admin/quips?deleted=1');
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') return res.status(404).render('error', { title: 'Not Found', message: 'Quip not found.' });
    throw err;
  }
});

// ── Delete Log ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/logs/:id/delete', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid log ID.' });
  try {
    await db.readingLog.delete({ where: { id } });
    res.redirect('/admin/logs?deleted=1');
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });
    throw err;
  }
});

module.exports = router;
