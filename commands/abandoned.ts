/**
 * commands/abandoned.ts — /abandoned
 *
 * Ranks club books by how many members abandoned them.
 * Shows every club book with at least one abandonment.
 *
 * For each book: title, author, month/year (if set), abandoned count out of
 * total enrolled members.
 *
 * Re-reads: most recent log per user+book determines status.
 * Ties: competition ranking (1, 1, 3 — not 1, 1, 2).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { inArray, asc } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs } from '../schema';
import type { ReadingLog } from '../schema';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Keep only the most recent log per userId+bookId pair. */
function deduplicateByLatest(logs: ReadingLog[]): ReadingLog[] {
  const map = new Map<string, ReadingLog>();
  for (const log of logs) map.set(`${log.userId}:${log.bookId}`, log);
  return [...map.values()];
}

/** Competition ranking: 1, 1, 3, 4, 4, 6 … */
function assignRanks<T extends Record<string, unknown>>(rows: T[], key: string): Array<T & { rank: number }> {
  let rank = 1;
  return rows.map((row, i) => {
    if (i > 0 && (row[key] as number) < (rows[i - 1][key] as number)) rank = i + 1;
    return { ...row, rank };
  });
}

function medalFor(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}.`;
}

export const data = new SlashCommandBuilder()
  .setName('abandoned')
  .setDescription('Which Book of the Month reads were abandoned by the most members?');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const clubBookRows = await db.query.clubBooks.findMany({
    with: { book: true },
    where: (cb, { isNotNull, and }) => and(isNotNull(cb.month), isNotNull(cb.year)),
    orderBy: (cb, { asc }) => [asc(cb.createdAt)],
  });

  if (!clubBookRows.length) {
    await interaction.editReply({ content: 'No Book of the Month data found.' });
    return;
  }

  const clubBookIds = clubBookRows.map(cb => cb.bookId);

  const rawLogs = db.select().from(readingLogs)
    .where(inArray(readingLogs.bookId, clubBookIds))
    .orderBy(asc(readingLogs.startedAt))
    .all();

  const logs = deduplicateByLatest(rawLogs);

  // Per-book stats
  const enrolled: Record<number, number> = {};
  const abandoned: Record<number, number> = {};
  for (const log of logs) {
    enrolled[log.bookId] = (enrolled[log.bookId] ?? 0) + 1;
    if (log.status === 'abandoned') abandoned[log.bookId] = (abandoned[log.bookId] ?? 0) + 1;
  }

  const rows = clubBookRows
    .filter(cb => (abandoned[cb.bookId] ?? 0) > 0)
    .map(cb => {
      const monthYear = (cb.month && cb.year)
        ? ` (${MONTH_ABBR[cb.month - 1]} ${cb.year})`
        : '';
      return {
        label: `**${cb.book.title}** by ${cb.book.author}${monthYear}`,
        abandoned: abandoned[cb.bookId] ?? 0,
        enrolled: enrolled[cb.bookId] ?? 0,
      };
    })
    .sort((a, b) => b.abandoned - a.abandoned);

  if (!rows.length) {
    await interaction.editReply({ content: 'No club reads have been abandoned yet. 🎉' });
    return;
  }

  const ranked = assignRanks(rows, 'abandoned');

  const lines = ranked.map(r =>
    `${medalFor(r.rank)} ${r.label} — ${r.abandoned}/${r.enrolled} abandoned`
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📖 Most Abandoned Club Reads')
        .setDescription(lines.join('\n')),
    ],
  });
}
