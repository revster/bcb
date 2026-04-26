/**
 * commands/abandon.ts — /abandon
 *
 * Marks a book as abandoned at the current progress level. Must be run from
 * inside a bot-managed book thread owned by the user. Reflected in #progress
 * with a ✗ marker.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ThreadChannel, ForumChannel, TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { readingLogs, clubBooks } from '../schema';
import { buildBookEmbed } from '../lib/buildBookEmbed';
import { updateProgressPost, buildBar } from '../lib/progressPost';
import { botLog } from '../lib/botLog';

export const data = new SlashCommandBuilder()
  .setName('abandon')
  .setDescription('Mark this book as abandoned — run this from inside your book thread');

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

  db.update(readingLogs)
    .set({ status: 'abandoned' })
    .where(eq(readingLogs.threadId, interaction.channelId))
    .run();

  const progressDisplay = log.book.pages
    ? `page ${Math.round((log.progress / 100) * log.book.pages)} / ${log.book.pages}`
    : `${log.progress.toFixed(0)}%`;

  const embed = buildBookEmbed(
    log.book,
    `Abandoned at ${progressDisplay}`
  );

  await channel.send({ embeds: [embed] });

  const abandonedTag = (channel.parent as ForumChannel | null)?.availableTags?.find(t => t.name === 'Abandoned');
  if (abandonedTag) {
    const currentTags = channel.appliedTags as string[] ?? [];
    await channel.setAppliedTags([...new Set([...currentTags, abandonedTag.id])]).catch(() => null);
  }

  await interaction.reply({
    content: `Marked **${log.book.title}** as abandoned.`,
    flags: MessageFlags.Ephemeral,
  });
  await botLog(interaction.guild!, `[abandon] ${interaction.user.username} abandoned **${log.book.title}** at ${progressDisplay}`);

  await updateProgressPost(log.bookId, interaction.guild!);

  const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, log.bookId)).get();
  if (!clubBook) {
    const allChannels = await interaction.guild!.channels.fetch();
    const progressChannel = allChannels.find(c => c?.name === 'progress') as TextChannel | undefined;
    if (progressChannel) {
      const bar = buildBar(log.progress);
      const pctStr = `${Math.round(log.progress)}%`;
      const content = `📖 **${interaction.user.displayName}** abandoned *${log.book.title}* by ${log.book.author}\n\`${bar}  ${pctStr}  ✗\``;
      let posted = false;
      if (log.progressMessageId) {
        try {
          const msg = await progressChannel.messages.fetch(log.progressMessageId);
          await msg.edit(content);
          posted = true;
        } catch { /* message deleted — fall through */ }
      }
      if (!posted) {
        await progressChannel.send(content);
      }
    }
  }
}
