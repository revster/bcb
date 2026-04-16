/**
 * lib/reminders.js — weekly reading reminder pings
 *
 * Sends a funny quip to members who haven't logged progress on the current
 * Book of the Month in 7+ days. Only fires for the BOTM of the current
 * calendar month (won't nag about last month's book).
 *
 * Idempotent: skips users reminded within the last 7 days, so it's safe
 * to call this more than once a day (e.g. after a restart).
 */

const db = require('../db');

async function sendReminders(client) {
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // Find the BOTM for the current month
  const clubBook = await db.clubBook.findFirst({
    where: {
      month: now.getMonth() + 1,
      year:  now.getFullYear(),
    },
    include: { book: true },
  });

  if (!clubBook) return; // No BOTM this month — nothing to do

  // Find reading logs for this book where the user hasn't logged progress
  // in 7 days AND hasn't been reminded in 7 days
  const staleLogs = await db.readingLog.findMany({
    where: {
      bookId: clubBook.bookId,
      status: 'reading',
      AND: [
        {
          OR: [
            { lastProgressAt: { lt: sevenDaysAgo } },
            { lastProgressAt: null, startedAt: { lt: sevenDaysAgo } },
          ],
        },
        {
          OR: [
            { lastRemindedAt: null },
            { lastRemindedAt: { lt: sevenDaysAgo } },
          ],
        },
      ],
    },
  });

  if (staleLogs.length === 0) return;

  // Pick a random quip from the DB
  const quips = await db.reminderQuip.findMany();
  if (quips.length === 0) return;

  for (const log of staleLogs) {
    try {
      const quip = quips[Math.floor(Math.random() * quips.length)];

      // Find the thread to ping in
      if (!log.threadId) continue;

      const thread = await client.channels.fetch(log.threadId).catch(() => null);
      if (!thread) continue;

      await thread.send(`<@${log.userId}> ${quip.text}`);

      await db.readingLog.update({
        where: { id: log.id },
        data:  { lastRemindedAt: now },
      });
    } catch (err) {
      // Don't let one failed ping stop the rest
      console.error(`[reminders] Failed to remind user ${log.userId}:`, err);
    }
  }
}

module.exports = { sendReminders };
