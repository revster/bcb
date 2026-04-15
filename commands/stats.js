/**
 * commands/stats.js — /stats me | /stats user <user>
 *
 * Personal reading summary for yourself or another member:
 *   - Books finished, currently reading, and abandoned
 *   - Total pages read (finished books with known page counts)
 *   - Average rating given (logs where a rating was set)
 *   - Favourite genre (most common genre across finished books)
 *
 * Re-reads are counted as separate entries.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');

/**
 * Returns the most common genre across an array of Book records,
 * or null if no genre data is available.
 */
function favouriteGenre(books) {
  const counts = {};
  for (const book of books) {
    let genres = [];
    if (Array.isArray(book.genres)) {
      genres = book.genres;
    } else if (book.genres) {
      try { genres = JSON.parse(book.genres); } catch { /* skip */ }
    }
    for (const g of genres) counts[g] = (counts[g] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

async function buildStatsEmbed(userId, displayName) {
  const logs = await db.readingLog.findMany({
    where: { userId },
    include: { book: true },
    orderBy: { startedAt: 'asc' },
  });

  if (logs.length === 0) {
    return null; // caller handles the "no data" reply
  }

  const finished  = logs.filter(l => l.status === 'finished');
  const reading   = logs.filter(l => l.status === 'reading');
  const abandoned = logs.filter(l => l.status === 'abandoned');

  const totalPages = finished.reduce((sum, l) => sum + (l.book.pages || 0), 0);

  const rated = logs.filter(l => l.rating !== null);
  const avgRating = rated.length
    ? (rated.reduce((sum, l) => sum + l.rating, 0) / rated.length).toFixed(2)
    : null;

  const genre = favouriteGenre(finished.map(l => l.book));

  const embed = new EmbedBuilder()
    .setTitle(`📚 ${displayName}'s Reading Stats`);

  const counts = [
    `✅ Finished: **${finished.length}**`,
    `📖 Reading: **${reading.length}**`,
    `✗ Abandoned: **${abandoned.length}**`,
  ].join('\n');

  embed.addFields({ name: 'Books', value: counts });

  if (totalPages > 0) {
    embed.addFields({ name: 'Total Pages Read', value: totalPages.toLocaleString(), inline: true });
  }
  if (avgRating) {
    embed.addFields({ name: 'Avg Rating', value: `${avgRating} ⭐`, inline: true });
  }
  if (genre) {
    embed.addFields({ name: 'Favourite Genre', value: genre, inline: true });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Reading stats for yourself or another member')
    .addSubcommand(sub =>
      sub.setName('me').setDescription('Your personal reading stats')
    )
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription('Reading stats for another member')
        .addUserOption(o =>
          o.setName('user').setDescription('The member to look up').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    let userId, displayName;
    if (sub === 'me') {
      userId = interaction.user.id;
      displayName = interaction.user.displayName ?? interaction.user.username;
    } else {
      const target = interaction.options.getUser('user');
      userId = target.id;
      displayName = target.displayName ?? target.username;
    }

    await interaction.deferReply();

    const embed = await buildStatsEmbed(userId, displayName);

    if (!embed) {
      await interaction.editReply({
        content: `No reading history found for **${displayName}**.`,
      });
      return;
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
