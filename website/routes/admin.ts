const express = require('express');
const router = express.Router();
import { eq, inArray, and, asc, desc, count } from 'drizzle-orm';
const db = require('../../db');
import { books, readingLogs, clubBooks, users, memberChannels, reminderQuips } from '../../schema';
import scrapeBook from '../../lib/scrapeBook';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['reading', 'finished', 'abandoned']);

function getMembers() {
  const map = new Map<string, { userId: string; username: string }>();
  for (const m of db.select({ userId: memberChannels.userId, username: memberChannels.username }).from(memberChannels).all())
    map.set(m.userId, m);
  for (const u of db.select({ userId: users.userId, username: users.username }).from(users).all())
    map.set(u.userId, u);
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

function upsertClubBook(bookId: number, month: number | null, year: number | null) {
  db.insert(clubBooks)
    .values({ bookId, month, year })
    .onConflictDoUpdate({ target: clubBooks.bookId, set: { month, year } })
    .run();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/', async (req: any, res: any) => {
  const c = (t: Parameters<typeof db.select>[0]) => (db.select({ c: count() }).from(t).get() as { c: number }).c;
  const [logCount, bookCount, memberCount, clubBookCount] = [readingLogs, books, users, clubBooks].map(c);
  res.render('admin/dashboard', { logCount, bookCount, memberCount, clubBookCount });
});

// ── Reading Logs ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/logs', async (req: any, res: any) => {
  const { member: filterMember, status: filterStatus } = req.query;

  const whereClause = filterMember && filterStatus
    ? and(eq(readingLogs.userId, filterMember as string), eq(readingLogs.status, filterStatus as string))
    : filterMember ? eq(readingLogs.userId, filterMember as string)
    : filterStatus ? eq(readingLogs.status, filterStatus as string)
    : undefined;
  const logs: any[] = db.select().from(readingLogs)
    .leftJoin(books, eq(readingLogs.bookId, books.id))
    .where(whereClause)
    .orderBy(desc(readingLogs.startedAt))
    .all()
    .map((row: any) => ({ ...row.ReadingLog, book: row.Book }));
  const clubBookRows = db.select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year }).from(clubBooks).all();
  const members = getMembers();

  const userIds = [...new Set(logs.map((l: { userId: string }) => l.userId))];
  const nameMap: Record<string, string> = {};
  if (userIds.length) {
    for (const m of db.select({ userId: memberChannels.userId, username: memberChannels.username }).from(memberChannels).where(inArray(memberChannels.userId, userIds)).all())
      nameMap[m.userId] = m.username;
    for (const u of db.select({ userId: users.userId, username: users.username }).from(users).where(inArray(users.userId, userIds)).all())
      nameMap[u.userId] = u.username;
  }

  const clubBookMap = new Map(clubBookRows.map((cb: { bookId: number; month: number | null; year: number | null }) => [cb.bookId, cb]));

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

    let book = db.select().from(books).where(eq(books.goodreadsUrl, goodreadsUrl)).get();
    if (!book) {
      const scraped = await scrapeBook(goodreadsUrl);
      book = db.insert(books)
        .values({ title: scraped.title, author: scraped.author, goodreadsUrl, image: scraped.image, pages: scraped.pages, rating: scraped.rating, genres: JSON.stringify(scraped.genres) })
        .returning()
        .get()!;
    }

    db.insert(readingLogs).values({
      userId,
      bookId:     book.id,
      threadId:   null,
      status,
      rating:     parseOptionalFloat(rating),
      startedAt:  toDate(startedAt) ?? new Date(),
      finishedAt: toDate(finishedAt),
    }).run();

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
  const log = await db.query.readingLogs.findFirst({
    where: (rl: any, { eq }: any) => eq(rl.id, id),
    with: { book: true },
  }) as any;
  if (!log) return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });

  const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();

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

  const log = await db.query.readingLogs.findFirst({
    where: (rl: any, { eq }: any) => eq(rl.id, id),
    with: { book: true },
  }) as any;
  if (!log) return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });

  try {
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid status.');

    db.update(readingLogs).set({
      status,
      rating:     parseOptionalFloat(rating),
      startedAt:  toDate(startedAt) ?? log.startedAt,
      finishedAt: toDate(finishedAt),
    }).where(eq(readingLogs.id, id)).run();

    const existingClubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();

    if (isBotm === 'on') {
      await upsertClubBook(log.bookId, parseOptionalInt(botmMonth), parseOptionalInt(botmYear));
    } else if (existingClubBook) {
      // Only remove if there are no Discord channel messages tied to it (i.e. manually entered)
      if (!existingClubBook.progressMessageId) {
        db.delete(clubBooks).where(eq(clubBooks.bookId, log.bookId)).run();
      }
      // If there ARE Discord messages, leave it — removing it would break the bot's #progress post
    }

    res.redirect('/admin/logs?updated=1');
  } catch (err) {
    console.error('Update log error:', err);
    const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();
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
  const quips = db.select().from(reminderQuips).orderBy(asc(reminderQuips.createdAt)).all();
  const flash = req.query.created ? 'Quip added.'
              : req.query.deleted ? 'Quip deleted.'
              : null;
  res.render('admin/quips', { quips, flash, error: null });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/quips', async (req: any, res: any) => {
  const { text } = req.body;
  const quips = db.select().from(reminderQuips).orderBy(asc(reminderQuips.createdAt)).all();
  try {
    if (!text || !text.trim()) throw new Error('Quip text is required.');
    db.insert(reminderQuips).values({ text: text.trim() }).run();
    res.redirect('/admin/quips?created=1');
  } catch (err) {
    res.render('admin/quips', { quips, flash: null, error: (err as Error).message });
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/quips/:id/delete', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid quip ID.' });
  const result = db.delete(reminderQuips).where(eq(reminderQuips.id, id)).run();
  if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Quip not found.' });
  res.redirect('/admin/quips?deleted=1');
});

// ── Delete Log ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/logs/:id/delete', async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid log ID.' });
  const result = db.delete(readingLogs).where(eq(readingLogs.id, id)).run();
  if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Log not found.' });
  res.redirect('/admin/logs?deleted=1');
});

module.exports = router;
