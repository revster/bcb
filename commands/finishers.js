/**
 * commands/finishers.js — /finishers [year]
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

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { resolveUsernames } = require('../lib/resolveUsernames');

/** Keep only the most recent log per userId+bookId pair. */
function deduplicateByLatest(logs) {
  const map = new Map();
  for (const log of logs) map.set(`${log.userId}:${log.bookId}`, log);
  return [...map.values()];
}

/** Competition ranking: 1, 1, 3, 4, 4, 6 … */
function assignRanks(rows, key) {
  let rank = 1;
  return rows.map((row, i) => {
    if (i > 0 && row[key] < rows[i - 1][key]) rank = i + 1;
    return { ...row, rank };
  });
}

function medalFor(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}.`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('finishers')
    .setDescription('Who has completed the most Book of the Month club reads?')
    .addIntegerOption(o =>
      o.setName('year').setDescription('Filter to a specific year (e.g. 2026)').setMinValue(2020)
    ),

  async execute(interaction) {
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
      orderBy: { startedAt: 'asc' },
    });

    const logs = deduplicateByLatest(rawLogs);

    // Per-user stats
    const enrolled = {};
    const finished = {};
    for (const log of logs) {
      enrolled[log.userId] = (enrolled[log.userId] || 0) + 1;
      if (log.status === 'finished') finished[log.userId] = (finished[log.userId] || 0) + 1;
    }

    const userIds = Object.keys(enrolled).filter(id => (finished[id] || 0) > 0);
    if (!userIds.length) {
      await interaction.editReply({ content: 'No club read completions recorded yet.' });
      return;
    }

    const usernameMap = await resolveUsernames(userIds);

    const rows = userIds.map(userId => ({
      name: usernameMap[userId] || userId,
      finished: finished[userId],
      enrolled: enrolled[userId],
      rate: Math.round((finished[userId] / enrolled[userId]) * 100),
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
  },
};
