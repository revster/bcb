/**
 * commands/rate.js — /rate <rating>
 *
 * Saves a 1–5 star rating for the current book and posts it in the thread.
 * Must be run from inside a book thread created by /read.
 * Can be updated by running again.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { botLog } = require('../lib/botLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Rate this book — run this from inside your book thread')
    .addNumberOption(o =>
      o.setName('rating')
        .setDescription('Your rating (1–5 stars, decimals allowed e.g. 4.5)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5)
    ),

  async execute(interaction) {
    const botTag = interaction.channel.parent?.availableTags?.find(t => t.name === 'Bot');
    if (!botTag || !interaction.channel.appliedTags?.includes(botTag.id)) {
      await interaction.reply({
        content: 'This command can only be used inside a bot-managed book thread.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rating = interaction.options.getNumber('rating');

    const log = await db.readingLog.findUnique({
      where: { threadId: interaction.channelId },
      include: { book: true },
    });

    if (!log) {
      await interaction.reply({
        content: 'Run this command from inside one of your book threads.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (log.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'You can only rate books in your own book threads.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.readingLog.update({
      where: { threadId: interaction.channelId },
      data: { rating },
    });

    const stars = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? '½' : '';
    const starDisplay = '⭐'.repeat(stars) + half;

    await interaction.channel.send(starDisplay);

    await interaction.reply({ content: `Rating saved: ${starDisplay} (${rating})`, flags: MessageFlags.Ephemeral });
    await botLog(interaction.guild, `[rate] ${interaction.user.username} — **${log.book.title}**: ${starDisplay} (${rating})`);

    const clubBook = await db.clubBook.findUnique({ where: { bookId: log.bookId } });
    if (clubBook?.epilogueThreadId) {
      try {
        const epilogueThread = await interaction.guild.channels.fetch(clubBook.epilogueThreadId);
        await epilogueThread.send(`${interaction.user.username} rated **${log.book.title}**: ${starDisplay} (${rating})`);
      } catch (err) {
        console.error('[rate] failed to post rating in epilogue thread:', err);
      }
    }
  },
};
