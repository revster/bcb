/**
 * commands/progress.js — /progress
 *
 * Updates the member's reading progress. Accepts either a page number OR a
 * percentage (0–100) — exactly one is required. Progress is stored as a
 * percentage in the database.
 *
 * When progress reaches 100, automatically marks the book as finished:
 * posts a completion embed, links to the epilogue thread if a club read,
 * and updates #progress.
 *
 * Must be run from inside a bot-managed book thread owned by the user.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
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

    if (log.status === 'finished' || log.status === 'abandoned') {
      await interaction.reply({
        content: `**${log.book.title}** is already marked as ${log.status}.`,
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

    if (progress >= 100) {
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
        embed.addFields({ name: 'Pages read', value: String(log.book.pages), inline: true });
      }

      if (log.rating) {
        const stars = Math.floor(log.rating);
        const half = log.rating % 1 >= 0.5 ? '½' : '';
        embed.addFields({ name: 'Rating', value: '⭐'.repeat(stars) + half, inline: true });
      }

      await interaction.channel.send({ embeds: [embed] });

      const clubBook = await db.clubBook.findUnique({ where: { bookId: log.bookId } });
      if (clubBook?.epilogueThreadId) {
        const epilogueUrl = `https://discord.com/channels/${interaction.guildId}/${clubBook.epilogueThreadId}`;
        await interaction.channel.send(`Ready to discuss? Head to the epilogue thread: ${epilogueUrl}`);
      }

      await interaction.reply({
        content: `Marked **${log.book.title}** as finished. 🎉`,
        flags: MessageFlags.Ephemeral,
      });
      await botLog(interaction.guild, `[finish] ${interaction.user.username} finished **${log.book.title}** by ${log.book.author}`);
    } else {
      await db.readingLog.update({
        where: { threadId: interaction.channelId },
        data: { progress },
      });

      await interaction.channel.send(`📖 Progress updated: ${progressDisplay}`);
      await interaction.reply({ content: 'Progress logged!', flags: MessageFlags.Ephemeral });
      await botLog(interaction.guild, `[progress] ${interaction.user.username} — **${log.book.title}**: ${progressDisplay}`);
    }

    await updateProgressPost(log.bookId, interaction.guild);
  },
};
