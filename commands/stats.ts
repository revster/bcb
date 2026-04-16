/**
 * commands/stats.ts — /stats [user]
 *
 * Personal reading summary. Defaults to the caller; pass a user to look up
 * someone else.
 *
 * Two sections:
 *   All Reads — finished/reading/abandoned counts, total pages, avg rating,
 *               favourite genre (across all personal and club reads)
 *   Book of the Month — finished/abandoned counts, completion rate
 *                       (finished ÷ enrolled), avg rating for club reads only.
 *                       Omitted entirely if the user has no club read logs.
 *
 * Re-reads are counted as separate entries.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { readingLogs, clubBooks } from '../schema';
import type { LogWithBook } from '../schema';

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
    status: statuses.includes('finished') ? 'finished'
           : statuses.includes('reading')  ? 'reading'
           : 'abandoned',
  }));
}

async function buildStatsEmbed(userId: string, displayName: string): Promise<EmbedBuilder | null> {
  const logs = (await db.query.readingLogs.findMany({
    where: (rl, { eq }) => eq(rl.userId, userId),
    with: { book: true },
    orderBy: (rl, { asc }) => [asc(rl.startedAt)],
  })) as LogWithBook[];
  const clubBookRows = db.select({ bookId: clubBooks.bookId }).from(clubBooks).all();

  if (!logs.length) return null;

  const clubBookIds = new Set(clubBookRows.map(cb => cb.bookId));

  // Deduplicate by book so re-run club-start threads don't inflate counts
  const uniqueLogs     = deduplicateByBook(logs);
  const clubUniqueLogs = uniqueLogs.filter(l => clubBookIds.has(l.bookId));

  const allFinished  = uniqueLogs.filter(l => l.status === 'finished');
  const allReading   = uniqueLogs.filter(l => l.status === 'reading');
  const allAbandoned = uniqueLogs.filter(l => l.status === 'abandoned');

  const clubFinished  = clubUniqueLogs.filter(l => l.status === 'finished');
  const clubAbandoned = clubUniqueLogs.filter(l => l.status === 'abandoned');

  const totalPages = allFinished.reduce((sum, l) => sum + (l.book.pages ?? 0), 0);
  const genre      = favouriteGenre(allFinished.map(l => l.book));
  const allAvgRating  = avgRatingStr(logs);
  const clubAvgRating = avgRatingStr(logs.filter(l => clubBookIds.has(l.bookId)));

  const embed = new EmbedBuilder()
    .setTitle(`📚 ${displayName}'s Reading Stats`);

  // ── All Reads ──────────────────────────────────────────────────────────────
  const allCounts = [
    `✅ Finished: **${allFinished.length}**`,
    `📖 Reading:  **${allReading.length}**`,
    `✗  Abandoned: **${allAbandoned.length}**`,
  ].join('\n');

  embed.addFields({ name: '── All Reads ──', value: allCounts });

  if (totalPages > 0) {
    embed.addFields({ name: 'Total Pages Read', value: totalPages.toLocaleString(), inline: true });
  }
  if (allAvgRating) {
    embed.addFields({ name: 'Avg Rating', value: `${allAvgRating} ⭐`, inline: true });
  }
  if (genre) {
    embed.addFields({ name: 'Favourite Genre', value: genre, inline: true });
  }

  // ── Book of the Month ──────────────────────────────────────────────────────
  if (clubUniqueLogs.length > 0) {
    const enrolled = clubUniqueLogs.length;
    const rate = Math.round((clubFinished.length / enrolled) * 100);

    const clubCounts = [
      `✅ Finished: **${clubFinished.length}** (${clubFinished.length}/${enrolled}, ${rate}%)`,
      `✗  Abandoned: **${clubAbandoned.length}**`,
    ].join('\n');

    embed.addFields({ name: '── Book of the Month ──', value: clubCounts });

    if (clubAvgRating) {
      embed.addFields({ name: 'Avg Rating', value: `${clubAvgRating} ⭐`, inline: true });
    }
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
