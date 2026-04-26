/**
 * lib/progressPost.ts
 *
 * Maintains the two-message #progress post for a club book:
 *   Message 1 — book embed (title, author, cover, Goodreads link, metadata)
 *   Message 2 — monospace progress bar block, one row per member
 *
 * Both message IDs are stored on ClubBook so they can be edited in-place.
 * If either message is missing (deleted), both are recreated so they stay
 * adjacent. Called after any command that changes reading progress or status.
 */

import type { Guild, TextChannel } from 'discord.js';
import { eq, inArray, asc } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs, memberChannels } from '../schema';
import { buildBookEmbed } from './buildBookEmbed';
import { botLog } from './botLog';

export const PROGRESS_CHANNEL_NAME = 'the-marauders-map';
const BAR_LENGTH = 20;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function buildBar(pct: number, length = BAR_LENGTH): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

export async function updateProgressPost(bookId: number, guild: Guild): Promise<void> {
  const clubBook = await db.query.clubBooks.findFirst({
    where: (cb, { eq }) => eq(cb.bookId, bookId),
    with: { book: true },
  });
  if (!clubBook) return;

  const allLogs = db.select().from(readingLogs)
    .where(eq(readingLogs.bookId, bookId))
    .orderBy(asc(readingLogs.startedAt))
    .all();
  if (allLogs.length === 0) {
    await botLog(guild, `[progressPost] no reading logs for club bookId ${bookId}`);
    return;
  }

  // If a user has read the same book multiple times, show only their most recent log
  const seen = new Set<string>();
  const logs = allLogs.reverse().filter(l => {
    if (seen.has(l.userId)) return false;
    seen.add(l.userId);
    return true;
  }).reverse();

  // Build userId → username map from MemberChannel records
  const userIds = logs.map(l => l.userId);
  const mcRows = db.select({ userId: memberChannels.userId, username: memberChannels.username })
    .from(memberChannels)
    .where(inArray(memberChannels.userId, userIds))
    .all();
  const usernameMap = Object.fromEntries(mcRows.map(mc => [mc.userId, mc.username]));

  const names = logs.map(log => usernameMap[log.userId] ?? log.userId);
  const maxLen = Math.max(...names.map(n => n.length));

  const lines = logs.map((log, i) => {
    const pct = log.status === 'finished' ? 100 : log.progress;
    const bar = buildBar(pct);
    const pctStr = pct.toFixed(0).padStart(3) + '%';
    const tag = log.status === 'finished' ? ' ✓' : log.status === 'abandoned' ? ' ✗' : '';
    const name = names[i].padEnd(maxLen);
    return `${name}  ${bar}  ${pctStr}${tag}`;
  });

  const { book } = clubBook;
  const monthYearStr = (clubBook.month && clubBook.year)
    ? ` — ${MONTHS[clubBook.month - 1]} ${clubBook.year}`
    : '';

  const content = `**${book.title}** by ${book.author}${monthYearStr}`;
  const embed = buildBookEmbed(book);
  const barsContent = '```\n' + lines.join('\n') + '\n```';

  const allChannels = await guild.channels.fetch();
  const progressChannel = allChannels.find(c => c?.name === PROGRESS_CHANNEL_NAME) as TextChannel | undefined;
  if (!progressChannel) {
    await botLog(guild, `[progressPost] no channel named "${PROGRESS_CHANNEL_NAME}" found — create it to enable the progress board`);
    return;
  }

  // Try to edit both existing messages; if either is missing, recreate both so they stay adjacent
  if (clubBook.progressMessageId && clubBook.progressBarsMessageId) {
    try {
      const embedMsg = await progressChannel.messages.fetch(clubBook.progressMessageId);
      const barsMsg = await progressChannel.messages.fetch(clubBook.progressBarsMessageId);
      await embedMsg.edit({ content, embeds: [embed] });
      await barsMsg.edit({ content: barsContent });
      return;
    } catch {
      // One or both messages missing — fall through to recreate
    }
  }

  const embedMsg = await progressChannel.send({ content, embeds: [embed] });
  const barsMsg = await progressChannel.send({ content: barsContent });
  db.update(clubBooks)
    .set({ progressMessageId: embedMsg.id, progressBarsMessageId: barsMsg.id })
    .where(eq(clubBooks.bookId, bookId))
    .run();
}
