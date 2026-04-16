/**
 * lib/reminders.ts — weekly reading reminder pings
 *
 * Sends a funny quip to members who haven't logged progress on the current
 * Book of the Month in 7+ days. Only fires for the BOTM of the current
 * calendar month (won't nag about last month's book).
 *
 * Idempotent: skips users reminded within the last 7 days, so it's safe
 * to call this more than once a day (e.g. after a restart).
 */

import type { Client } from 'discord.js';
import db = require('../db');
import { botLog } from './botLog';

export async function sendReminders(client: Client): Promise<void> {
  const setting = await db.setting.findUnique({ where: { key: 'reminders_enabled' } });
  if (setting?.value === 'false') return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Find all BOTMs for the current month (there may be more than one)
  const clubBooks = await db.clubBook.findMany({
    where: {
      month: now.getMonth() + 1,
      year:  now.getFullYear(),
    },
  });

  if (clubBooks.length === 0) return;

  const bookIds = clubBooks.map(cb => cb.bookId);

  const staleLogs = await db.readingLog.findMany({
    where: {
      bookId: { in: bookIds },
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

  const quips = await db.reminderQuip.findMany();
  if (quips.length === 0) return;

  for (const log of staleLogs) {
    try {
      const quip = quips[Math.floor(Math.random() * quips.length)];

      if (!log.threadId) continue;

      const thread = await client.channels.fetch(log.threadId).catch(() => null);
      if (!thread || !('send' in thread)) continue;

      await thread.send(`<@${log.userId}> ${quip.text}`);

      await db.readingLog.update({
        where: { id: log.id },
        data:  { lastRemindedAt: now },
      });
    } catch (err) {
      const guild = client.guilds.cache.first();
      if (guild) await botLog(guild, `[reminders] failed to remind user ${log.userId}: ${(err as Error)?.message ?? String(err)}`);
    }
  }
}
