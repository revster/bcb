/**
 * commands/progress.js — /progress
 *
 * Updates the member's reading progress. Accepts either a page number OR a
 * percentage (0–100) — exactly one is required. Progress is stored as a
 * percentage in the database.
 *
 * Must be run from inside a book thread created by /read.
 * If the book is a club read, also updates the #progress channel post.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { updateProgressPost } = require('../lib/progressPost');
const { botLog } = require('../lib/botLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('progress')
    .setDescription('Log your reading progress — run this from inside your book thread')
    .addIntegerOption(o =>
      o.setName('page').setDescription('Current page number').setMinValue(1)
    )
    .addNumberOption(o =>
      o.setName('percentage').setDescription('Percentage read (0–100)').setMinValue(0).setMaxValue(100)
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

    const page = interaction.options.getInteger('page');
    const percentage = interaction.options.getNumber('percentage');

    if (page === null && percentage === null) {
      await interaction.reply({
        content: 'Provide either a `page` number or a `percentage` (0–100).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (page !== null && percentage !== null) {
      await interaction.reply({
        content: 'Provide either `page` or `percentage`, not both.',
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
        content: 'You can only update progress in your own book threads.',
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

    let progress;
    let progressDisplay;

    if (page !== null) {
      if (!log.book.pages) {
        await interaction.reply({
          content: "This book has no known page count. Use `percentage` instead.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (page > log.book.pages) {
        await interaction.reply({
          content: `That's past the end of the book (${log.book.pages} pages). Double-check your page number.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      progress = (page / log.book.pages) * 100;
      progressDisplay = `page **${page} / ${log.book.pages}**`;
    } else {
      progress = percentage;
      progressDisplay = `**${percentage % 1 === 0 ? percentage : percentage.toFixed(1)}%**`;
    }

    await db.readingLog.update({
      where: { threadId: interaction.channelId },
      data: { progress },
    });

    await interaction.channel.send(`📖 Progress updated: ${progressDisplay}`);
    await interaction.reply({ content: 'Progress logged!', flags: MessageFlags.Ephemeral });
    await botLog(interaction.guild, `[progress] ${interaction.user.username} — **${log.book.title}**: ${progressDisplay}`);

    await updateProgressPost(log.bookId, interaction.guild);
  },
};
