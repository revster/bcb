/**
 * commands/rate.js — /rate <rating>
 *
 * Saves a 1–5 star rating for the current book and posts it in the thread.
 * Must be run from inside a book thread created by /read.
 * Can be updated by running again.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');

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

    await db.readingLog.update({
      where: { threadId: interaction.channelId },
      data: { rating },
    });

    const stars = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? '½' : '';
    const starDisplay = '⭐'.repeat(stars) + half;

    await interaction.channel.send(starDisplay);

    await interaction.reply({ content: `Rating saved: ${starDisplay} (${rating})`, flags: MessageFlags.Ephemeral });
  },
};
