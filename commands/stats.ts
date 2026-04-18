/**
 * commands/stats.ts — /stats [user]
 *
 * Personal reading summary. Defaults to the caller; pass a user to look up
 * someone else.
 *
 * Sections:
 *   Currently Reading — mini progress bars for in-progress books
 *   This Year / All Time — finished/reading/abandoned counts side by side
 *   All-time extras — pages, avg rating, favourite genre, longest book
 *   Book of the Month — This Year and All Time subsections with streak
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { asc } from 'drizzle-orm';
import db = require('../db');
import { readingLogs, clubBooks } from '../schema';
import type { LogWithBook } from '../schema';

const BAR_LENGTH = 15;
const TITLE_MAX = 25;

function buildBar(pct: number): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function favouriteGenre(books: Array<{ genres: string | null }>): string | null {
  const counts: Record<string, number> = {};
  for (const book of books) {
    let genres: string[] = [];
    if (book.genres) {
      try { genres = JSON.parse(book.genres); } catch { /* skip */ }
    }
    for (const g of genres) counts[g] = (counts[g] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function avgRatingStr(logs: Array<{ rating: number | null }>): string | null {
  const rated = logs.filter(l => l.rating !== null) as Array<{ rating: number }>;
  if (!rated.length) return null;
  return (rated.reduce((sum, l) => sum + l.rating, 0) / rated.length).toFixed(2);
}

/**
 * Deduplicates logs by bookId, keeping one effective status per book.
 * Priority: finished > reading > abandoned.
 * Logs must be pre-sorted by startedAt asc so the last entry per book
 * carries the most recent book metadata.
 */
function deduplicateByBook(logs: LogWithBook[]): LogWithBook[] {
  const groups = new Map<number, { log: LogWithBook; statuses: string[] }>();
  for (const log of logs) {
    const g = groups.get(log.bookId);
    if (!g) { groups.set(log.bookId, { log, statuses: [log.status] }); }
    else     { g.log = log; g.statuses.push(log.status); }
  }
  return [...groups.values()].map(({ log, statuses }) => ({
    ...log,
    status: statuses.includes('finished')  ? 'finished'
           : statuses.includes('reading')   ? 'reading'
           : statuses.includes('abandoned') ? 'abandoned'
           : 'dnr',
  }));
}

/**
 * Computes the longest ever streak of consecutive BOTM completions.
 * Only counts club books that have both month and year set.
 * Streak begins from the user's first enrolled BOTM book (joining late is fine).
 * An enrolled-but-unfinished month resets the streak.
 * The last entry being in-progress (reading) does not break the streak.
 */
function computeLongestStreak(
  clubBooksOrdered: Array<{ bookId: number; month: number | null; year: number | null }>,
  statusByBookId: Map<number, string>,
): number {
  const eligible = clubBooksOrdered.filter(cb => cb.month !== null && cb.year !== null);

  // Group books by month/year so multiple books in the same month count as one streak unit.
  // Finishing any one book in a month is enough to keep the streak alive.
  const monthMap = new Map<string, number[]>();
  for (const cb of eligible) {
    const key = `${cb.year}-${cb.month}`;
    if (!monthMap.has(key)) monthMap.set(key, []);
    monthMap.get(key)!.push(cb.bookId);
  }

  const sortedMonths = [...monthMap.entries()].sort(([a], [b]) => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return ay !== by ? ay - by : am - bm;
  });

  // Start streak from the first month where the user has any log
  const firstIdx = sortedMonths.findIndex(([, bookIds]) =>
    bookIds.some(id => statusByBookId.has(id))
  );
  if (firstIdx === -1) return 0;

  let best = 0;
  let current = 0;

  for (let i = firstIdx; i < sortedMonths.length; i++) {
    const [, bookIds] = sortedMonths[i];
    const isLast = i === sortedMonths.length - 1;
    const statuses = bookIds.map(id => statusByBookId.get(id));

    const hasFinished = statuses.some(s => s === 'finished');
    const hasReading  = statuses.some(s => s === 'reading');

    if (hasFinished) {
      current++;
      if (current > best) best = current;
    } else if (hasReading && isLast) {
      // At least one book still in progress this month — don't break streak
    } else {
      current = 0;
    }
  }

  return best;
}

async function buildStatsEmbed(userId: string, displayName: string): Promise<EmbedBuilder | null> {
  const currentYear = new Date().getFullYear();

  const logs = (await db.query.readingLogs.findMany({
    where: (rl, { eq }) => eq(rl.userId, userId),
    with: { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];

  const clubBookRows = db.select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
    .from(clubBooks)
    .orderBy(asc(clubBooks.year), asc(clubBooks.month))
    .all();

  if (!logs.length) return null;

  const botmBookIds = new Set(
    clubBookRows.filter(cb => cb.month !== null && cb.year !== null).map(cb => cb.bookId)
  );
  const clubBookYearMap = new Map(clubBookRows.map(cb => [cb.bookId, cb.year]));

  const uniqueLogs     = deduplicateByBook(logs);
  const clubUniqueLogs = uniqueLogs.filter(l => botmBookIds.has(l.bookId));
  const clubLogsThisYear = clubUniqueLogs.filter(l => clubBookYearMap.get(l.bookId) === currentYear);

  // ── All Reads ──────────────────────────────────────────────────────────────
  const allFinished  = uniqueLogs.filter(l => l.status === 'finished');
  const allReading   = uniqueLogs.filter(l => l.status === 'reading');
  const allAbandoned = uniqueLogs.filter(l => l.status === 'abandoned');

  const thisYearLogs      = uniqueLogs.filter(l => l.startedAt.getFullYear() === currentYear);
  const thisYearFinished  = thisYearLogs.filter(l => l.status === 'finished');
  const thisYearReading   = thisYearLogs.filter(l => l.status === 'reading');
  const thisYearAbandoned = thisYearLogs.filter(l => l.status === 'abandoned');

  // ── BOTM ──────────────────────────────────────────────────────────────────
  const clubFinished          = clubUniqueLogs.filter(l => l.status === 'finished');
  const clubAbandoned         = clubUniqueLogs.filter(l => l.status === 'abandoned');
  const clubDnr               = clubUniqueLogs.filter(l => l.status === 'dnr');
  const clubFinishedThisYear  = clubLogsThisYear.filter(l => l.status === 'finished');
  const clubAbandonedThisYear = clubLogsThisYear.filter(l => l.status === 'abandoned');
  const clubDnrThisYear       = clubLogsThisYear.filter(l => l.status === 'dnr');

  // ── Extra stats ───────────────────────────────────────────────────────────
  const totalPages = allFinished.reduce((sum, l) => sum + (l.book.pages ?? 0), 0);
  const longestBook = allFinished
    .filter(l => l.book.pages !== null)
    .sort((a, b) => (b.book.pages ?? 0) - (a.book.pages ?? 0))[0] ?? null;
  const genre             = favouriteGenre(allFinished.map(l => l.book));
  const allAvgRating      = avgRatingStr(logs);
  const clubAvgRating     = avgRatingStr(clubUniqueLogs);
  const clubAvgThisYear   = avgRatingStr(clubLogsThisYear);

  const statusByBotmBookId = new Map(clubUniqueLogs.map(l => [l.bookId, l.status]));
  const longestStreak      = computeLongestStreak(clubBookRows, statusByBotmBookId);

  // ── Build embed ───────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle(`📚 ${displayName}'s Reading Stats`);

  // Currently reading
  if (allReading.length > 0) {
    const displayTitles = allReading.map(l => truncate(l.book.title, TITLE_MAX));
    const maxLen = Math.max(...displayTitles.map(t => t.length));
    const barLines = allReading.map((l, i) => {
      const pct = l.progress ?? 0;
      const bar = buildBar(pct);
      const pctStr = pct.toFixed(0).padStart(3) + '%';
      return `${displayTitles[i].padEnd(maxLen)}  ${bar}  ${pctStr}`;
    });
    embed.addFields({ name: '📖 Currently Reading', value: '```\n' + barLines.join('\n') + '\n```' });
  }

  // This Year / All Time counts
  const allTimeCounts = [
    `✅ Finished: **${allFinished.length}**`,
    `📖 Reading:  **${allReading.length}**`,
    `✗  Abandoned: **${allAbandoned.length}**`,
  ].join('\n');

  if (thisYearLogs.length > 0) {
    const thisYearCounts = [
      `✅ Finished: **${thisYearFinished.length}**`,
      `📖 Reading:  **${thisYearReading.length}**`,
      `✗  Abandoned: **${thisYearAbandoned.length}**`,
    ].join('\n');
    embed.addFields(
      { name: '📅 This Year', value: thisYearCounts, inline: true },
      { name: '📚 All Time',  value: allTimeCounts,  inline: true },
    );
  } else {
    embed.addFields({ name: '📚 All Time', value: allTimeCounts });
  }

  if (totalPages > 0) {
    embed.addFields({ name: 'Total Pages Read', value: totalPages.toLocaleString(), inline: true });
  }
  if (allAvgRating) {
    embed.addFields({ name: 'Avg Rating', value: `${allAvgRating} ⭐`, inline: true });
  }
  if (genre) {
    embed.addFields({ name: 'Favourite Genre', value: genre, inline: true });
  }
  if (longestBook) {
    embed.addFields({ name: 'Longest Finished', value: `${longestBook.book.title} (${longestBook.book.pages} pages)`, inline: true });
  }

  // BOTM sections
  if (clubUniqueLogs.length > 0) {
    embed.addFields({ name: '\u200b', value: '\u200b' });

    // This Year
    if (clubLogsThisYear.length > 0) {
      const enrolledThisYear = clubLogsThisYear.length;
      const rateThisYear = Math.round((clubFinishedThisYear.length / enrolledThisYear) * 100);
      const lines = [
        `✅ Finished: **${clubFinishedThisYear.length}** (${clubFinishedThisYear.length}/${enrolledThisYear}, ${rateThisYear}%)`,
        `✗  Abandoned: **${clubAbandonedThisYear.length}**`,
        `—  Did not read: **${clubDnrThisYear.length}**`,
      ];
      if (clubAvgThisYear) lines.push(`Avg rating: ${clubAvgThisYear} ⭐`);
      embed.addFields({ name: '🏆 Book of the Month — This Year', value: lines.join('\n') });
    }

    // All Time
    const enrolled = clubUniqueLogs.length;
    const rate = Math.round((clubFinished.length / enrolled) * 100);
    const lines = [
      `✅ Finished: **${clubFinished.length}** (${clubFinished.length}/${enrolled}, ${rate}%)`,
      `✗  Abandoned: **${clubAbandoned.length}**`,
      `—  Did not read: **${clubDnr.length}**`,
    ];
    if (longestStreak > 0) lines.push(`🔥 Longest streak: **${longestStreak}** month${longestStreak !== 1 ? 's' : ''}`);
    if (clubAvgRating) lines.push(`Avg rating: ${clubAvgRating} ⭐`);
    embed.addFields({ name: '🏆 Book of the Month — All Time', value: lines.join('\n') });
  }

  return embed;
}

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Reading stats for yourself or another member')
  .addUserOption(o =>
    o.setName('user').setDescription('Member to look up (defaults to you)')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const userId = target.id;
  const displayName = target.displayName ?? target.username;

  await interaction.deferReply();

  const embed = await buildStatsEmbed(userId, displayName);

  if (!embed) {
    await interaction.editReply({
      content: `No reading history found for **${displayName}**.`,
    });
    return;
  }

  await interaction.editReply({ embeds: [embed] });
}
