/**
 * commands/progress.ts — /progress
 *
 * Updates the member's reading progress. Accepts either a page number OR a
 * percentage (0–100) — exactly one is required. Progress is stored as a
 * float percentage in the database.
 *
 * Special cases:
 *   - Progress = 100: automatically marks the book as finished, posts a
 *     completion embed, and links to the epilogue thread if a club read.
 *   - Book was abandoned: logging progress resumes it (status → "reading").
 *
 * Must be run from inside a bot-managed book thread owned by the user.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, ThreadChannel, ForumChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { readingLogs, clubBooks } from '../schema';
import { updateProgressPost } from '../lib/progressPost';
import { botLog } from '../lib/botLog';

export const data = new SlashCommandBuilder()
  .setName('progress')
  .setDescription('Log your reading progress — run this from inside your book thread')
  .addIntegerOption(o =>
    o.setName('page').setDescription('Current page number').setMinValue(1)
  )
  .addNumberOption(o =>
    o.setName('percentage').setDescription('Percentage read (0–100)').setMinValue(0).setMaxValue(100)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as ThreadChannel;
  const botTag = (channel.parent as ForumChannel | null)?.availableTags?.find(t => t.name === 'Bot');
  if (!botTag || !(channel.appliedTags as string[] | undefined)?.includes(botTag.id)) {
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

  const log = await db.query.readingLogs.findFirst({
    where: (rl, { eq }) => eq(rl.threadId, interaction.channelId),
    with: { book: true },
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

  let progress: number;
  let progressDisplay: string;

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
    progress = percentage!;
    progressDisplay = `**${percentage! % 1 === 0 ? percentage : percentage!.toFixed(1)}%**`;
  }

  if (progress >= 100) {
    const finishedAt = new Date();

    db.update(readingLogs)
      .set({ status: 'finished', finishedAt, progress: 100, lastProgressAt: new Date() })
      .where(eq(readingLogs.threadId, interaction.channelId))
      .run();

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

    await channel.send({ embeds: [embed] });

    const completedTag = (channel.parent as ForumChannel | null)?.availableTags?.find(t => t.name === 'Completed');
    if (completedTag) {
      const currentTags = channel.appliedTags as string[] ?? [];
      await channel.setAppliedTags([...new Set([...currentTags, completedTag.id])]).catch(() => null);
    }

    const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();
    if (clubBook?.epilogueThreadId) {
      const epilogueUrl = `https://discord.com/channels/${interaction.guildId}/${clubBook.epilogueThreadId}`;
      await channel.send(`Ready to discuss? Head to the epilogue thread: ${epilogueUrl}`);
    }

    await interaction.reply({
      content: `Marked **${log.book.title}** as finished. 🎉`,
      flags: MessageFlags.Ephemeral,
    });
    await botLog(interaction.guild!, `[finish] ${interaction.user.username} finished **${log.book.title}** by ${log.book.author}`);
  } else {
    const wasAbandoned = log.status === 'abandoned';
    db.update(readingLogs)
      .set({ progress, lastProgressAt: new Date(), ...(wasAbandoned && { status: 'reading' }) })
      .where(eq(readingLogs.threadId, interaction.channelId))
      .run();

    const resumedNote = wasAbandoned ? ' (resumed)' : '';
    await channel.send(`📖 Progress updated: ${progressDisplay}${resumedNote}`);
    await interaction.reply({ content: `Progress logged!${resumedNote}`, flags: MessageFlags.Ephemeral });
    await botLog(interaction.guild!, `[progress] ${interaction.user.username} — **${log.book.title}**: ${progressDisplay}${resumedNote}`);
  }

  await updateProgressPost(log.bookId, interaction.guild!);
}
