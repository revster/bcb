/**
 * commands/abandon.js — /abandon
 *
 * Marks a book as abandoned at the current progress level. Must be run from
 * inside a bot-managed book thread owned by the user. Reflected in #progress
 * with a ✗ marker.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { buildBookEmbed } = require('../lib/buildBookEmbed');
const { updateProgressPost } = require('../lib/progressPost');
const { botLog } = require('../lib/botLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('abandon')
    .setDescription('Mark this book as abandoned — run this from inside your book thread'),

  async execute(interaction) {
    const botTag = interaction.channel.parent?.availableTags?.find(t => t.name === 'Bot');
    if (!botTag || !interaction.channel.appliedTags?.includes(botTag.id)) {
      await interaction.reply({
        content: 'This command can only be used inside a bot-managed book thread.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
        content: 'You can only abandon books in your own book threads.',
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

    if (log.status === 'abandoned') {
      await interaction.reply({
        content: `**${log.book.title}** is already marked as abandoned.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.readingLog.update({
      where: { threadId: interaction.channelId },
      data: { status: 'abandoned' },
    });

    const progressDisplay = log.book.pages
      ? `page ${Math.round((log.progress / 100) * log.book.pages)} / ${log.book.pages}`
      : `${log.progress.toFixed(0)}%`;

    const embed = buildBookEmbed(
      log.book,
      `Abandoned at ${progressDisplay}`
    );

    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({
      content: `Marked **${log.book.title}** as abandoned.`,
      flags: MessageFlags.Ephemeral,
    });
    await botLog(interaction.guild, `[abandon] ${interaction.user.username} abandoned **${log.book.title}** at ${progressDisplay}`);

    await updateProgressPost(log.bookId, interaction.guild);
  },
};
