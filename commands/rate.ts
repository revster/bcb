/**
 * commands/rate.ts — /rate <rating>
 *
 * Saves a 1–5 star rating (decimals allowed) for the current book and posts
 * it in the thread. Can be run at any point — reading, finished, or abandoned.
 * Re-running overwrites the previous rating.
 *
 * If the book is an active club read, also posts the rating in the epilogue
 * thread so members who have finished can see it.
 *
 * Must be run from inside a bot-managed book thread owned by the user.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ThreadChannel, ForumChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { readingLogs, clubBooks } from '../schema';
import { botLog } from '../lib/botLog';

export const data = new SlashCommandBuilder()
  .setName('rate')
  .setDescription('Rate this book — run this from inside your book thread')
  .addNumberOption(o =>
    o.setName('rating')
      .setDescription('Your rating (1–5 stars, decimals allowed e.g. 4.5)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(5)
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

  const rating = interaction.options.getNumber('rating', true);

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
      content: 'You can only rate books in your own book threads.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  db.update(readingLogs)
    .set({ rating })
    .where(eq(readingLogs.threadId, interaction.channelId))
    .run();

  const stars = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? '½' : '';
  const starDisplay = '⭐'.repeat(stars) + half;

  await channel.send(starDisplay);

  await interaction.reply({ content: `Rating saved: ${starDisplay} (${rating})`, flags: MessageFlags.Ephemeral });
  await botLog(interaction.guild!, `[rate] ${interaction.user.username} — **${log.book.title}**: ${starDisplay} (${rating})`);

  const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();
  if (clubBook?.epilogueThreadId) {
    try {
      const epilogueThread = await interaction.guild!.channels.fetch(clubBook.epilogueThreadId) as ThreadChannel;
      await epilogueThread.send(`${interaction.user.username} rated **${log.book.title}**: ${starDisplay} (${rating})`);
    } catch (err) {
      await botLog(interaction.guild!, `[rate] failed to post in epilogue thread: ${(err as Error)?.message ?? String(err)}`);
    }
  }
}
