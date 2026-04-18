/**
 * commands/club-stats.ts — /club-stats <year> [user]
 *
 * BOTM participation for a given year. One embed field per user.
 * Emojis: ✅ finished  💀 abandoned  ❌ DNR  ➖ not in club / no data
 *
 * Cases:
 *   year only     → all users for that year (one field per user)
 *   user + year   → that user for that year (one field)
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { eq, and, isNotNull, inArray, asc } from 'drizzle-orm';
import db = require('../db');
import { clubBooks, readingLogs } from '../schema';
import { resolveUsernames } from '../lib/resolveUsernames';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function emojiFor(status: string | undefined): string {
  switch (status) {
    case 'finished':  return '✅';
    case 'abandoned': return '💀';
    case 'dnr':       return '❌';
    default:          return '➖';
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

/**
 * Builds the two-row field value for a single user's participation in a year.
 * All 12 months are shown; months with no BOTM entry or no user log show ➖.
 */
function buildUserFieldValue(
  allClubBooks: ClubBookRow[],
  userId: string,
  statusMap: Map<string, string>,
): string {
  const monthToBookId = new Map<number, number>();
  for (const cb of allClubBooks) {
    monthToBookId.set(cb.month!, cb.bookId);
  }

  const cells = MONTH_NAMES.map((name, i) => {
    const bookId = monthToBookId.get(i + 1);
    const status = bookId !== undefined ? statusMap.get(`${userId}:${bookId}`) : undefined;
    return `${name} ${emojiFor(status)}`;
  });

  return cells.slice(0, 6).join(' · ') + '\n' + cells.slice(6).join(' · ');
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('club-stats')
  .setDescription('Show who read, skipped, or abandoned each Book of the Month')
  .addIntegerOption(o =>
    o.setName('year').setDescription('Year to display').setMinValue(2020).setRequired(true)
  )
  .addUserOption(o =>
    o.setName('user').setDescription('Member to look up (defaults to all members)')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const year       = interaction.options.getInteger('year', true);
  const targetUser = interaction.options.getUser('user');
  const userId     = targetUser?.id ?? null;

  await interaction.deferReply();

  // ── Fetch club books for this year ────────────────────────────────────────

  const allClubBooks: ClubBookRow[] = db
    .select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year })
    .from(clubBooks)
    .where(and(eq(clubBooks.year, year), isNotNull(clubBooks.month)))
    .orderBy(asc(clubBooks.month))
    .all();

  if (!allClubBooks.length) {
    await interaction.editReply({ content: `No BOTM data found for ${year}.` });
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

  const legend = '✅ read  💀 abandoned  ❌ DNR  ➖ not in club';
  const displayName = targetUser ? (targetUser.displayName ?? targetUser.username) : null;

  const embed = new EmbedBuilder()
    .setTitle(displayName
      ? `📊 ${displayName}'s ${year} Club Reads`
      : `📊 Club Read Participation — ${year}`)
    .setDescription(legend);

  for (const uid of sortedUserIds) {
    embed.addFields({
      name:  usernameMap[uid] ?? uid,
      value: buildUserFieldValue(allClubBooks, uid, statusMap),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
