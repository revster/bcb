/**
 * commands/finish.js — /finish
 *
 * Marks a book as finished, posts a completion summary embed in the thread,
 * and closes the reading log. Must be run from inside a book thread.
 * If the book is a club read, also updates the #progress channel post.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { updateProgressPost } = require('../lib/progressPost');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('finish')
    .setDescription('Mark this book as finished — run this from inside your book thread'),

  async execute(interaction) {
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

    if (log.status === 'finished') {
      await interaction.reply({
        content: `**${log.book.title}** is already marked as finished.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const finishedAt = new Date();

    await db.readingLog.update({
      where: { threadId: interaction.channelId },
      data: { status: 'finished', finishedAt, progress: 100 },
    });

    const embed = new EmbedBuilder()
      .setTitle(log.book.title)
      .setURL(log.book.goodreadsUrl)
      .setAuthor({ name: log.book.author })
      .setDescription('Finished! 🎉');

    if (log.book.image) embed.setThumbnail(log.book.image);

    embed.addFields({ name: 'Started', value: log.startedAt.toDateString(), inline: true });
    embed.addFields({ name: 'Finished', value: finishedAt.toDateString(), inline: true });

    if (log.book.pages) {
      const pagesRead = Math.round((log.progress / 100) * log.book.pages);
      embed.addFields({ name: 'Pages read', value: `${pagesRead} / ${log.book.pages}`, inline: true });
    } else if (log.progress > 0) {
      embed.addFields({ name: 'Progress', value: `${log.progress.toFixed(0)}%`, inline: true });
    }

    if (log.rating) {
      const stars = Math.floor(log.rating);
      const half = log.rating % 1 >= 0.5 ? '½' : '';
      embed.addFields({ name: 'Rating', value: '⭐'.repeat(stars) + half, inline: true });
    }

    await interaction.channel.send({ embeds: [embed] });

    await interaction.reply({
      content: `Marked **${log.book.title}** as finished. 🎉`,
      flags: MessageFlags.Ephemeral,
    });

    await updateProgressPost(log.bookId, interaction.guild);
  },
};
