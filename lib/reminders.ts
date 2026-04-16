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
import { eq, and, or, inArray, isNull, lt } from 'drizzle-orm';
import db = require('../db');
import { settings, clubBooks, readingLogs, reminderQuips } from '../schema';
import { botLog } from './botLog';

export async function sendReminders(client: Client): Promise<void> {
  const setting = db.select().from(settings).where(eq(settings.key, 'reminders_enabled')).get();
  if (setting?.value === 'false') return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Find all BOTMs for the current month (there may be more than one)
  const clubBookRows = db.select({ bookId: clubBooks.bookId }).from(clubBooks)
    .where(and(eq(clubBooks.month, now.getMonth() + 1), eq(clubBooks.year, now.getFullYear())))
    .all();

  if (clubBookRows.length === 0) return;

  const bookIds = clubBookRows.map(cb => cb.bookId);

  const staleLogs = db.select().from(readingLogs).where(
    and(
      inArray(readingLogs.bookId, bookIds),
      eq(readingLogs.status, 'reading'),
      or(
        lt(readingLogs.lastProgressAt, sevenDaysAgo),
        and(isNull(readingLogs.lastProgressAt), lt(readingLogs.startedAt, sevenDaysAgo))
      ),
      or(
        isNull(readingLogs.lastRemindedAt),
        lt(readingLogs.lastRemindedAt, sevenDaysAgo)
      )
    )
  ).all();

  if (staleLogs.length === 0) return;

  const quips = db.select().from(reminderQuips).all();
  if (quips.length === 0) return;

  for (const log of staleLogs) {
    try {
      const quip = quips[Math.floor(Math.random() * quips.length)];

      if (!log.threadId) continue;

      const thread = await client.channels.fetch(log.threadId).catch(() => null);
      if (!thread || !('send' in thread)) continue;

      await thread.send(`<@${log.userId}> ${quip.text}`);

      db.update(readingLogs).set({ lastRemindedAt: now }).where(eq(readingLogs.id, log.id)).run();
    } catch (err) {
      const guild = client.guilds.cache.first();
      if (guild) await botLog(guild, `[reminders] failed to remind user ${log.userId}: ${(err as Error)?.message ?? String(err)}`);
    }
  }
}
