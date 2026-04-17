/**
 * commands/abandoners.ts — /abandoners [year]
 *
 * Ranks members by number of Book of the Month club reads abandoned.
 * Shows every member with at least one abandonment.
 *
 * For each member: abandoned count, enrolled count, and abandonment rate.
 * Optional year filter.
 *
 * Re-reads: most recent log per user+book determines status.
 * Ties: competition ranking (1, 1, 3 — not 1, 1, 2).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs } from '../schema';
import type { ReadingLog } from '../schema';
import { resolveUsernames } from '../lib/resolveUsernames';

/**
 * Groups logs by userId+bookId and applies status priority:
 * finished > reading > abandoned.
 * A book only counts as abandoned if no log for it is finished or reading.
 * Returns a map of userId → { enrolled, abandoned }.
 */
function userStats(logs: ReadingLog[]): { enrolled: Record<string, number>; abandoned: Record<string, number> } {
  const groups = new Map<string, { userId: string; statuses: string[] }>();
  for (const log of logs) {
    const key = `${log.userId}:${log.bookId}`;
    if (!groups.has(key)) groups.set(key, { userId: log.userId, statuses: [] });
    groups.get(key)!.statuses.push(log.status);
  }
  const enrolled: Record<string, number> = {};
  const abandoned: Record<string, number> = {};
  for (const { userId, statuses } of groups.values()) {
    enrolled[userId] = (enrolled[userId] ?? 0) + 1;
    if (!statuses.includes('finished') && !statuses.includes('reading')) {
      abandoned[userId] = (abandoned[userId] ?? 0) + 1;
    }
  }
  return { enrolled, abandoned };
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
  .setName('abandoners')
  .setDescription('Who has abandoned the most Book of the Month club reads?')
  .addIntegerOption(o =>
    o.setName('year').setDescription('Filter to a specific year (e.g. 2026)').setMinValue(2020)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const year = interaction.options.getInteger('year');

  await interaction.deferReply();

  const clubBookRows = year
    ? db.select({ bookId: clubBooks.bookId }).from(clubBooks).where(and(eq(clubBooks.year, year), isNotNull(clubBooks.month))).all()
    : db.select({ bookId: clubBooks.bookId }).from(clubBooks).where(and(isNotNull(clubBooks.month), isNotNull(clubBooks.year))).all();

  if (!clubBookRows.length) {
    await interaction.editReply({
      content: year
        ? `No Book of the Month data found for ${year}.`
        : 'No Book of the Month data found.',
    });
    return;
  }

  const clubBookIds = clubBookRows.map(cb => cb.bookId);

  const rawLogs = db.select().from(readingLogs).where(inArray(readingLogs.bookId, clubBookIds)).all();

  const { enrolled, abandoned } = userStats(rawLogs);

  const userIds = Object.keys(enrolled).filter(id => (abandoned[id] ?? 0) > 0);
  if (!userIds.length) {
    await interaction.editReply({ content: 'No club read abandonments recorded yet.' });
    return;
  }

  const usernameMap = await resolveUsernames(userIds);

  const rows = userIds.map(userId => ({
    name: usernameMap[userId] ?? userId,
    abandoned: abandoned[userId] ?? 0,
    enrolled: enrolled[userId] ?? 0,
    rate: Math.round(((abandoned[userId] ?? 0) / (enrolled[userId] ?? 1)) * 100),
  })).sort((a, b) => b.abandoned - a.abandoned || b.rate - a.rate);

  const ranked = assignRanks(rows, 'abandoned');

  const lines = ranked.map(r =>
    `${medalFor(r.rank)} **${r.name}** — ${r.abandoned} abandoned (${r.abandoned}/${r.enrolled}, ${r.rate}%)`
  );

  const title = year
    ? `📖 Club Read Abandoners — ${year}`
    : '📖 Club Read Abandoners (All Time)';

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(lines.join('\n'))],
  });
}
