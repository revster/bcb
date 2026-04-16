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
import db = require('../db');
import { buildBookEmbed } from './buildBookEmbed';
import { botLog } from './botLog';

const PROGRESS_CHANNEL_NAME = 'progress';
const BAR_LENGTH = 20;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildBar(pct: number): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

export async function updateProgressPost(bookId: number, guild: Guild): Promise<void> {
  const clubBook = await db.clubBook.findUnique({
    where: { bookId },
    include: { book: true },
  });
  if (!clubBook) return;

  const allLogs = await db.readingLog.findMany({
    where: { bookId },
    orderBy: { startedAt: 'asc' },
  });
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
  const memberChannels = await db.memberChannel.findMany({
    where: { userId: { in: logs.map(l => l.userId) } },
  });
  const usernameMap = Object.fromEntries(memberChannels.map(mc => [mc.userId, mc.username]));

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
  await db.clubBook.update({
    where: { bookId },
    data: { progressMessageId: embedMsg.id, progressBarsMessageId: barsMsg.id },
  });
}
