/**
 * commands/read.ts — /read <url>
 *
 * Starts a reading log for a member. Scrapes the Goodreads book page, creates
 * a thread in the member's personal forum channel, upserts a Book record, and
 * opens a ReadingLog tied to that thread.
 *
 * All subsequent commands (/progress, /rate, /finish) are run from inside the
 * thread and route via its threadId — no extra book argument needed.
 *
 * Re-running /read for the same book starts a new log (useful for re-reads).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ForumChannel, TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { memberChannels, books, readingLogs, clubBooks } from '../schema';
import scrapeBook from '../lib/scrapeBook';
import { buildBookEmbed } from '../lib/buildBookEmbed';
import { updateProgressPost, buildBar } from '../lib/progressPost';
import { botLog } from '../lib/botLog';

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;

export const data = new SlashCommandBuilder()
  .setName('read')
  .setDescription('Start tracking a book — creates a thread in your reading channel')
  .addStringOption(o =>
    o.setName('url').setDescription('Goodreads book URL').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);

  if (!GOODREADS_BOOK_RE.test(url)) {
    await interaction.reply({
      content: 'Please provide a valid Goodreads book URL (e.g. `https://www.goodreads.com/book/show/...`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer ephemerally — scraping + channel ops can take a few seconds
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let bookData: Awaited<ReturnType<typeof scrapeBook>> | null = null;
  try {
    bookData = await scrapeBook(url);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await botLog(interaction.guild!, `[read] scrape failed for ${url}: ${msg}`);
    await interaction.editReply(`Could not fetch book info: ${msg}`);
    return;
  }

  const { title, author, rating, pages, image, genres } = bookData;

  // Look up the member's registered forum channel
  const memberChannel = db.select().from(memberChannels).where(eq(memberChannels.userId, interaction.user.id)).get();

  if (!memberChannel) {
    await interaction.editReply("Your reading channel hasn't been registered yet. Ask an admin to use `/register`.");
    return;
  }

  // Fetch the forum channel from Discord
  const forumChannel = await interaction.guild!.channels.fetch(memberChannel.channelId).catch(() => null) as ForumChannel | null;
  if (!forumChannel) {
    await interaction.editReply("Your reading channel no longer exists or I can't access it. Ask an admin to update your registration with `/register`.");
    return;
  }

  // Upsert the book record
  const book = db.insert(books)
    .values({ title, author, rating, pages, image, genres: JSON.stringify(genres), goodreadsUrl: url })
    .onConflictDoUpdate({
      target: books.goodreadsUrl,
      set: { title, author, rating, pages, image, genres: JSON.stringify(genres) },
    })
    .returning()
    .get()!;

  // Build the opening embed posted as the thread's first message
  const embed = buildBookEmbed(
    { title, author, rating, pages, image, genres, goodreadsUrl: url },
    `Started reading on ${new Date().toDateString()}`
  );

  // Create the thread in the member's forum channel, applying the Bot tag if it exists
  const botTagId = forumChannel.availableTags?.find(t => t.name === 'Bot')?.id;
  const thread = await forumChannel.threads.create({
    name: `${title} by ${author}`.slice(0, 100),
    message: { embeds: [embed] },
    ...(botTagId ? { appliedTags: [botTagId] } : {}),
  });

  // Open the reading log
  db.insert(readingLogs).values({
    userId: interaction.user.id,
    bookId: book.id,
    threadId: thread.id,
  }).run();
  const log = db.select().from(readingLogs).where(eq(readingLogs.threadId, thread.id)).get()!;

  await interaction.editReply(`Your thread for **${title}** is live! [Jump to thread](${thread.url})`);
  await botLog(interaction.guild!, `[read] ${interaction.user.username} started **${title}** by ${author}`);

  await updateProgressPost(book.id, interaction.guild!);

  // For personal books (not a club read), post an initial 0% entry to #progress
  const clubBook = db.select().from(clubBooks).where(eq(clubBooks.bookId, book.id)).get();
  if (!clubBook) {
    const allChannels = await interaction.guild!.channels.fetch();
    const progressChannel = allChannels.find(c => c?.name === 'progress') as TextChannel | undefined;
    if (progressChannel) {
      const bar = buildBar(0);
      const content = `📖 **${interaction.user.displayName}** started reading *${title}* by ${author}\n\`${bar}  0%\``;
      const msg = await progressChannel.send(content);
      db.update(readingLogs).set({ progressMessageId: msg.id }).where(eq(readingLogs.id, log.id)).run();
    }
  }
}
