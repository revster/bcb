/**
 * commands/club-stats.ts — /club-stats [user] [year]
 *
 * BOTM participation grid. Symbols:
 *   ✓  finished
 *   X  did not read (enrolled, never started)
 *   A  abandoned (started but didn't finish)
 *   ?  currently reading
 *   .  not in club that month
 *
 * Cases:
 *   no args       → all users, all years (one embed field per year)
 *   year only     → all users for that year (one grid)
 *   user only     → that user, all years (one block per year)
 *   user + year   → that user, that year (one grid)
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { eq, and, isNotNull, inArray, asc } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs } from '../schema';
import { resolveUsernames } from '../lib/resolveUsernames';

const MONTH_ABBR = ['Ja', 'Fe', 'Mr', 'Ap', 'My', 'Jn',
                    'Jl', 'Au', 'Se', 'Oc', 'No', 'De'];

function symbolFor(status: string | undefined): string {
  switch (status) {
    case 'finished':  return '✓';
    case 'abandoned': return 'A';
    case 'dnr':       return 'X';
    case 'reading':   return '?';
    default:          return '.';
  }
}

/** Priority dedup across multiple logs for the same user+book. */
function effectiveStatus(statuses: string[]): string {
  if (statuses.includes('finished'))  return 'finished';
  if (statuses.includes('reading'))   return 'reading';
  if (statuses.includes('abandoned')) return 'abandoned';
  return 'dnr';
}

type ClubBookRow = { bookId: number; month: number | null; year: number | null };

function groupByYear(cbs: ClubBookRow[]): Map<number, ClubBookRow[]> {
  const map = new Map<number, ClubBookRow[]>();
  for (const cb of cbs) {
    const y = cb.year!;
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(cb);
  }
  return map;
}

/**
 * Multi-user grid for a single year's books.
 * Returns raw monospace text (no code fences).
 */
function buildYearGrid(
  yearBooks: ClubBookRow[],
  userIds: string[],
  statusMap: Map<string, string>,
  usernameMap: Record<string, string>,
): string {
  const months     = yearBooks.map(cb => MONTH_ABBR[(cb.month ?? 1) - 1]);
  const maxNameLen = Math.max(...userIds.map(id => (usernameMap[id] ?? id).length), 4);
  const pad        = (s: string, w: number) => s.padEnd(w);

  const header = pad('', maxNameLen + 2) + months.map(m => `|${m} `).join('') + '|';
  const sep    = '─'.repeat(header.length);

  const rows = userIds.map(uid => {
    const name  = usernameMap[uid] ?? uid;
    const cells = yearBooks.map(cb => `| ${symbolFor(statusMap.get(`${uid}:${cb.bookId}`))} `);
    return pad(name, maxNameLen + 2) + cells.join('') + '|';
  });

  return [header, sep, ...rows].join('\n');
}

/**
 * Single-user grid across all years.
 * Each year renders as two lines: month header + symbol row.
 * Years where the user has no logs at all are skipped.
 */
function buildUserGrid(
  booksByYear: Map<number, ClubBookRow[]>,
  userId: string,
  statusMap: Map<string, string>,
): string {
  const years    = [...booksByYear.keys()].sort((a, b) => a - b);
  const sections: string[] = [];

  for (const year of years) {
    const yearBooks = booksByYear.get(year)!;

    // Skip years where this user has no log of any kind
    if (!yearBooks.some(cb => statusMap.has(`${userId}:${cb.bookId}`))) continue;

    const months  = yearBooks.map(cb => MONTH_ABBR[(cb.month ?? 1) - 1]);
    const header  = String(year).padEnd(6) + months.map(m => `|${m} `).join('') + '|';
    const symbols = ' '.repeat(6) + yearBooks.map(cb => `| ${symbolFor(statusMap.get(`${userId}:${cb.bookId}`))} `).join('') + '|';
    sections.push(header + '\n' + symbols);
  }

  return sections.join('\n\n');
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('club-stats')
  .setDescription('Show who read, skipped, or abandoned each Book of the Month')
  .addUserOption(o =>
    o.setName('user').setDescription('Member to look up (defaults to all members)')
  )
  .addIntegerOption(o =>
    o.setName('year').setDescription('Filter to a specific year (defaults to all years)').setMinValue(2020)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user');
  const year       = interaction.options.getInteger('year');
  const userId     = targetUser?.id ?? null;

  await interaction.deferReply();

  // ── Fetch club books ──────────────────────────────────────────────────────

  const allClubBooks: ClubBookRow[] = year
    ? db.select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
        .from(clubBooks)
        .where(and(eq(clubBooks.year, year), isNotNull(clubBooks.month)))
        .orderBy(asc(clubBooks.month))
        .all()
    : db.select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
        .from(clubBooks)
        .where(and(isNotNull(clubBooks.month), isNotNull(clubBooks.year)))
        .orderBy(asc(clubBooks.year), asc(clubBooks.month))
        .all();

  if (!allClubBooks.length) {
    await interaction.editReply({
      content: year ? `No BOTM data found for ${year}.` : 'No BOTM data found.',
    });
    return;
  }

  const clubBookIds = allClubBooks.map(cb => cb.bookId);

  // ── Fetch logs ────────────────────────────────────────────────────────────

  const rawLogs = userId
    ? db.select().from(readingLogs)
        .where(and(inArray(readingLogs.bookId, clubBookIds), eq(readingLogs.userId, userId)))
        .all()
    : db.select().from(readingLogs)
        .where(inArray(readingLogs.bookId, clubBookIds))
        .all();

  // ── Build status map: `${userId}:${bookId}` → effective status ───────────

  const groups = new Map<string, string[]>();
  for (const log of rawLogs) {
    const key = `${log.userId}:${log.bookId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log.status);
  }
  const statusMap = new Map<string, string>();
  for (const [key, statuses] of groups) {
    statusMap.set(key, effectiveStatus(statuses));
  }

  // ── Determine users to display ────────────────────────────────────────────

  const userIds: string[] = userId
    ? [userId]
    : [...new Set(rawLogs.map(l => l.userId))];

  if (!userIds.length) {
    await interaction.editReply({ content: 'No participation data found.' });
    return;
  }

  const usernameMap = await resolveUsernames(userIds);

  // Sort by finished count desc, then name asc
  const finishedCount = (uid: string) =>
    allClubBooks.filter(cb => statusMap.get(`${uid}:${cb.bookId}`) === 'finished').length;

  const sortedUserIds = userId
    ? [userId]
    : [...userIds].sort((a, b) =>
        finishedCount(b) - finishedCount(a) ||
        (usernameMap[a] ?? a).localeCompare(usernameMap[b] ?? b)
      );

  // ── Build embed ───────────────────────────────────────────────────────────

  const legend = '`✓` read  `X` DNR  `A` abandoned  `.` not in club';
  const embed  = new EmbedBuilder();

  if (userId) {
    const displayName = targetUser!.displayName ?? targetUser!.username;

    if (year) {
      // Single user, single year
      const grid = buildYearGrid(allClubBooks, [userId], statusMap, usernameMap);
      embed
        .setTitle(`📊 ${displayName}'s ${year} Club Reads`)
        .setDescription(legend + '\n```\n' + grid + '\n```');
    } else {
      // Single user, all years
      const booksByYear = groupByYear(allClubBooks);
      const grid = buildUserGrid(booksByYear, userId, statusMap);
      if (!grid) {
        await interaction.editReply({ content: `No BOTM participation found for **${displayName}**.` });
        return;
      }
      embed
        .setTitle(`📊 ${displayName}'s Club Read History`)
        .setDescription(legend + '\n```\n' + grid + '\n```');
    }
  } else {
    if (year) {
      // All users, single year
      const grid = buildYearGrid(allClubBooks, sortedUserIds, statusMap, usernameMap);
      embed
        .setTitle(`📊 Club Read Participation — ${year}`)
        .setDescription(legend + '\n```\n' + grid + '\n```');
    } else {
      // All users, all years — one field per year
      embed.setTitle('📊 Club Read Participation — All Time').setDescription(legend);

      const booksByYear = groupByYear(allClubBooks);
      const years = [...booksByYear.keys()].sort((a, b) => a - b);

      for (const y of years) {
        const yearBooks    = booksByYear.get(y)!;
        const yearUserIds  = sortedUserIds.filter(uid =>
          yearBooks.some(cb => statusMap.has(`${uid}:${cb.bookId}`))
        );
        if (!yearUserIds.length) continue;
        const grid = buildYearGrid(yearBooks, yearUserIds, statusMap, usernameMap);
        embed.addFields({ name: String(y), value: '```\n' + grid + '\n```' });
      }
    }
  }

  await interaction.editReply({ embeds: [embed] });
}
