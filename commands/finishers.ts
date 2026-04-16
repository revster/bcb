/**
 * commands/finishers.ts — /finishers [year]
 *
 * Ranks members by number of Book of the Month club reads completed.
 * Shows every member with at least one finish.
 *
 * For each member: finished count, enrolled count (club books they had a
 * thread for), and completion rate. Optional year filter.
 *
 * Re-reads: most recent log per user+book determines status.
 * Ties: competition ranking (1, 1, 3 — not 1, 1, 2).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { ReadingLog } from '@prisma/client';
import db = require('../db');
import { resolveUsernames } from '../lib/resolveUsernames';

/**
 * Groups logs by userId+bookId and applies status priority:
 * finished > reading > abandoned.
 * Returns a map of userId → { enrolled, finished }.
 */
function userStats(logs: ReadingLog[]): { enrolled: Record<string, number>; finished: Record<string, number> } {
  const groups = new Map<string, { userId: string; statuses: string[] }>();
  for (const log of logs) {
    const key = `${log.userId}:${log.bookId}`;
    if (!groups.has(key)) groups.set(key, { userId: log.userId, statuses: [] });
    groups.get(key)!.statuses.push(log.status);
  }
  const enrolled: Record<string, number> = {};
  const finished: Record<string, number> = {};
  for (const { userId, statuses } of groups.values()) {
    enrolled[userId] = (enrolled[userId] ?? 0) + 1;
    if (statuses.includes('finished')) finished[userId] = (finished[userId] ?? 0) + 1;
  }
  return { enrolled, finished };
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
  .setName('finishers')
  .setDescription('Who has completed the most Book of the Month club reads?')
  .addIntegerOption(o =>
    o.setName('year').setDescription('Filter to a specific year (e.g. 2026)').setMinValue(2020)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const year = interaction.options.getInteger('year');

  await interaction.deferReply();

  const clubBooks = await db.clubBook.findMany({
    where: year ? { year } : {},
    select: { bookId: true },
  });

  if (!clubBooks.length) {
    await interaction.editReply({
      content: year
        ? `No Book of the Month data found for ${year}.`
        : 'No Book of the Month data found.',
    });
    return;
  }

  const clubBookIds = clubBooks.map(cb => cb.bookId);

  const rawLogs = await db.readingLog.findMany({
    where: { bookId: { in: clubBookIds } },
  });

  const { enrolled, finished } = userStats(rawLogs);

  const userIds = Object.keys(enrolled).filter(id => (finished[id] ?? 0) > 0);
  if (!userIds.length) {
    await interaction.editReply({ content: 'No club read completions recorded yet.' });
    return;
  }

  const usernameMap = await resolveUsernames(userIds);

  const rows = userIds.map(userId => ({
    name: usernameMap[userId] ?? userId,
    finished: finished[userId] ?? 0,
    enrolled: enrolled[userId] ?? 0,
    rate: Math.round(((finished[userId] ?? 0) / (enrolled[userId] ?? 1)) * 100),
  })).sort((a, b) => b.finished - a.finished || b.rate - a.rate);

  const ranked = assignRanks(rows, 'finished');

  const lines = ranked.map(r =>
    `${medalFor(r.rank)} **${r.name}** — ${r.finished} finished (${r.finished}/${r.enrolled}, ${r.rate}%)`
  );

  const title = year
    ? `📚 Club Read Finishers — ${year}`
    : '📚 Club Read Finishers (All Time)';

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(lines.join('\n'))],
  });
}
