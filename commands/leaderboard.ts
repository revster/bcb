/**
 * commands/leaderboard.ts — /leaderboard [year]
 *
 * Without a year: ranked list of members by total Book of the Month completions
 * (all time).
 *
 * With a year: a monospace grid of members × months for that year, showing who
 * finished each month's club read. Totals per member appear on the right;
 * totals per month appear in the footer row.
 *
 * Only ClubBook reads count — personal /read threads are excluded.
 * If a member has multiple logs for the same club book (re-reads), the book
 * counts as finished if any of their logs has status "finished".
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { eq, and, isNotNull, inArray, asc } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs } from '../schema';
import { resolveUsernames } from '../lib/resolveUsernames';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── All-time leaderboard ────────────────────────────────────────────────────

async function buildAllTime(): Promise<EmbedBuilder | null> {
  const clubBookRows = db.select({ bookId: clubBooks.bookId }).from(clubBooks)
    .where(and(isNotNull(clubBooks.month), isNotNull(clubBooks.year)))
    .all();
  if (!clubBookRows.length) return null;

  const clubBookIds = clubBookRows.map(cb => cb.bookId);

  const logs = db.select().from(readingLogs)
    .where(and(inArray(readingLogs.bookId, clubBookIds), eq(readingLogs.status, 'finished')))
    .all();

  if (!logs.length) return null;

  // Count finished club books per user (deduplicate re-reads by userId+bookId)
  const finishedPairs = new Set(logs.map(l => `${l.userId}:${l.bookId}`));
  const counts: Record<string, number> = {};
  for (const pair of finishedPairs) {
    const userId = pair.split(':')[0];
    counts[userId] = (counts[userId] ?? 0) + 1;
  }

  const userIds = Object.keys(counts);
  const usernameMap = await resolveUsernames(userIds);

  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count], i) => ({
      rank: i + 1,
      name: usernameMap[userId] ?? userId,
      count,
    }));

  const lines = ranked.map(r => {
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}.`;
    const books = r.count === 1 ? 'book' : 'books';
    return `${medal} **${r.name}** — ${r.count} ${books}`;
  });

  return new EmbedBuilder()
    .setTitle('📚 Book of the Month Leaderboard (All Time)')
    .setDescription(lines.join('\n'));
}

// ─── Year grid leaderboard ───────────────────────────────────────────────────

async function buildYearGrid(year: number): Promise<EmbedBuilder | null> {
  // Club books for this year that have a month assigned, sorted by month
  const clubBookRows = db.select().from(clubBooks)
    .where(and(eq(clubBooks.year, year), isNotNull(clubBooks.month)))
    .orderBy(asc(clubBooks.month))
    .all();

  if (!clubBookRows.length) return null;

  const clubBookIds = clubBookRows.map(cb => cb.bookId);

  // All reading logs for this year's club books (any status)
  const logs = db.select().from(readingLogs)
    .where(inArray(readingLogs.bookId, clubBookIds))
    .all();

  if (!logs.length) return null;

  // Finished set: "userId:bookId"
  const finishedSet = new Set(
    logs.filter(l => l.status === 'finished').map(l => `${l.userId}:${l.bookId}`)
  );

  // Unique users who have any log for this year's club books
  const userIds = [...new Set(logs.map(l => l.userId))];
  const usernameMap = await resolveUsernames(userIds);

  // Build rows: one per user, sorted by total finished desc then name asc
  const rows = userIds.map(userId => {
    const name = usernameMap[userId] ?? userId;
    const cells = clubBookRows.map(cb =>
      finishedSet.has(`${userId}:${cb.bookId}`) ? '✓' : '-'
    );
    const total = cells.filter(c => c === '✓').length;
    return { name, cells, total };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Column totals (how many members finished each month)
  const colTotals = clubBookRows.map((_, colIdx) =>
    rows.filter(r => r.cells[colIdx] === '✓').length
  );

  // ── Formatting ──────────────────────────────────────────────────────────────
  const COL_W = 5; // width per month column
  const maxNameLen = Math.max(...rows.map(r => r.name.length), 4);

  const pad = (str: string, width: number): string => str.padEnd(width);
  const center = (str: string, width: number): string => {
    const total = width - str.length;
    const left = Math.floor(total / 2);
    return ' '.repeat(left) + str + ' '.repeat(total - left);
  };

  const months = clubBookRows.map(cb => MONTH_ABBR[(cb.month ?? 1) - 1]);

  // Header row
  const header = pad('', maxNameLen + 2)
    + months.map(m => center(m, COL_W)).join('')
    + center('Total', COL_W + 1);

  // Separator
  const separator = '─'.repeat(header.length);

  // Data rows
  const dataRows = rows.map(r =>
    pad(r.name, maxNameLen + 2)
    + r.cells.map(c => center(c, COL_W)).join('')
    + center(String(r.total), COL_W + 1)
  );

  // Totals row
  const totalsRow = pad('Total', maxNameLen + 2)
    + colTotals.map(t => center(String(t), COL_W)).join('');

  const grid = [header, separator, ...dataRows, separator, totalsRow].join('\n');

  return new EmbedBuilder()
    .setTitle(`📚 Book of the Month Leaderboard — ${year}`)
    .setDescription('```\n' + grid + '\n```');
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Book of the Month completion leaderboard')
  .addIntegerOption(o =>
    o.setName('year')
      .setDescription('Show grid for a specific year (e.g. 2026)')
      .setMinValue(2020)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const year = interaction.options.getInteger('year');

  await interaction.deferReply();

  const embed = year
    ? await buildYearGrid(year)
    : await buildAllTime();

  if (!embed) {
    const msg = year
      ? `No Book of the Month data found for ${year}.`
      : 'No Book of the Month completions recorded yet.';
    await interaction.editReply({ content: msg });
    return;
  }

  await interaction.editReply({ embeds: [embed] });
}
