/**
 * commands/club-start.ts — /club-start <url> [month] [year]
 *
 * Admin-only. Designates a Goodreads book as the active club read:
 *   1. Scrapes (or reuses) the Book record; upserts ClubBook with optional
 *      month/year for display in #progress.
 *   2. Always creates a new thread in every registered member's forum channel,
 *      applying "Bot" and "Book of the Month" tags (errors if tags cannot be applied).
 *   3. Creates a ReadingLog for each new thread.
 *   4. Creates a spoiler discussion thread in #epilogue (once per club book;
 *      skipped on re-runs if epilogueThreadId is already stored).
 *   5. Creates or refreshes the two #progress messages (embed + bars).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, ForumChannel } from 'discord.js';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import db = require('../db');
import { books, clubBooks, memberChannels, readingLogs } from '../schema';
import scrapeBook from '../lib/scrapeBook';
import { buildBookEmbed } from '../lib/buildBookEmbed';
import { updateProgressPost } from '../lib/progressPost';
import { botLog } from '../lib/botLog';

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;
const BOT_TAG_NAME = 'Bot';
const BOTM_TAG_NAME = 'Book of the Month';
const EPILOGUE_CHANNEL_NAME = 'epilogue';
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const data = new SlashCommandBuilder()
  .setName('club-start')
  .setDescription('Mark a book as the active club read — creates threads for all registered members')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o =>
    o.setName('url').setDescription('Goodreads book URL').setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('month').setDescription('Month this book is for (1–12)').setMinValue(1).setMaxValue(12)
  )
  .addIntegerOption(o =>
    o.setName('year').setDescription('Year this book is for (e.g. 2026)')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  const month = interaction.options.getInteger('month');
  const year = interaction.options.getInteger('year');

  if ((month === null) !== (year === null)) {
    await interaction.reply({
      content: 'Please provide both `month` and `year`, or neither.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!GOODREADS_BOOK_RE.test(url)) {
    await interaction.reply({
      content: 'Please provide a valid Goodreads book URL (e.g. `https://www.goodreads.com/book/show/...`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Find existing book record or scrape it fresh
  let book = db.select().from(books).where(eq(books.goodreadsUrl, url)).get();
  if (!book) {
    let scraped: Awaited<ReturnType<typeof scrapeBook>> | null = null;
    try {
      scraped = await scrapeBook(url);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      await botLog(interaction.guild!, `[club-start] scrape failed for ${url}: ${msg}`);
      await interaction.editReply(`Could not fetch book info from Goodreads: ${msg}`);
      return;
    }
    const { title, author, rating, pages, image, genres } = scraped;
    book = db.insert(books)
      .values({ title, author, rating, pages, image, genres: JSON.stringify(genres), goodreadsUrl: url })
      .onConflictDoUpdate({
        target: books.goodreadsUrl,
        set: { title, author, rating, pages, image, genres: JSON.stringify(genres) },
      })
      .returning()
      .get()!;
  }

  const clubBook = db.insert(clubBooks)
    .values({ bookId: book.id, month, year })
    .onConflictDoUpdate({
      target: clubBooks.bookId,
      set: { month, year },
    })
    .returning()
    .get()!;

  // Create a thread in every registered member's forum channel
  const allMemberChannels = db.select().from(memberChannels).all();

  // ── Auto-DNR previous BOTM ────────────────────────────────────────────────
  // When starting an official BOTM, stamp any member whose reading log for the
  // previous BOTM is still untouched (status='reading', progress=0) as DNR.
  if (month && year) {
    const allPrevCbs = db
      .select({ bookId: clubBooks.bookId, month: clubBooks.month, year: clubBooks.year, title: books.title })
      .from(clubBooks)
      .innerJoin(books, eq(clubBooks.bookId, books.id))
      .where(and(isNotNull(clubBooks.month), isNotNull(clubBooks.year)))
      .all();

    const currentOrdinal = year * 12 + month;
    const prevCb = allPrevCbs
      .filter(cb => cb.year! * 12 + cb.month! < currentOrdinal)
      .sort((a, b) => (b.year! * 12 + b.month!) - (a.year! * 12 + a.month!))[0] ?? null;

    if (prevCb) {
      const memberUserIds = allMemberChannels.map(mc => mc.userId);
      const toAutoDnr = memberUserIds.length > 0
        ? db.select({ userId: readingLogs.userId })
            .from(readingLogs)
            .where(and(
              eq(readingLogs.bookId, prevCb.bookId),
              inArray(readingLogs.userId, memberUserIds),
              eq(readingLogs.status, 'reading'),
              eq(readingLogs.progress, 0),
            ))
            .all()
        : [];

      if (toAutoDnr.length > 0) {
        const dnrUserIds = toAutoDnr.map(l => l.userId);
        db.update(readingLogs)
          .set({ status: 'dnr' })
          .where(and(
            eq(readingLogs.bookId, prevCb.bookId),
            inArray(readingLogs.userId, dnrUserIds),
          ))
          .run();

        const dnrUsernames = allMemberChannels
          .filter(mc => dnrUserIds.includes(mc.userId))
          .map(mc => mc.username);
        const prevMonthYear = `${MONTHS[prevCb.month! - 1]} ${prevCb.year}`;
        await botLog(interaction.guild!,
          `[club-start] Auto-DNR set for **${prevCb.title}** (${prevMonthYear}): ${dnrUsernames.join(', ')}`
        );
      }
    }
  }
  const embed = buildBookEmbed(book, `Started reading on ${new Date().toDateString()}`);
  const threadTagNames = month && year
    ? [BOT_TAG_NAME, BOTM_TAG_NAME]
    : [BOT_TAG_NAME];

  const results = await Promise.allSettled(
    allMemberChannels.map(async mc => {
      const forumChannel = await interaction.guild!.channels.fetch(mc.channelId) as ForumChannel;

      // Collect tag IDs for any matching tag names that exist on this channel
      const appliedTags = threadTagNames
        .map(name => forumChannel.availableTags?.find(t => t.name === name))
        .filter((t): t is NonNullable<typeof t> => t != null)
        .map(t => t.id);

      const missingTags = threadTagNames.filter(
        name => !forumChannel.availableTags?.some(t => t.name === name)
      );
      if (missingTags.length > 0) {
        await botLog(interaction.guild!,
          `[club-start] <@${interaction.user.id}> — <#${mc.channelId}> (${mc.username}) is missing tags: ${missingTags.join(', ')}. Commands like /progress will not work in the created thread until the tags are added.`
        );
      }

      const thread = await forumChannel.threads.create({
        name: `${book!.title} by ${book!.author}`,
        message: { embeds: [embed] },
        appliedTags,
      });

      db.insert(readingLogs).values({ userId: mc.userId, bookId: book!.id, threadId: thread.id }).run();

      return { username: mc.username, status: 'created' };
    })
  );

  // Create the epilogue discussion thread if it doesn't already exist
  let epilogueUrl: string | null = null;
  if (!clubBook.epilogueThreadId) {
    const allChannels = await interaction.guild!.channels.fetch();
    const epilogueChannel = allChannels.find(c => c?.name === EPILOGUE_CHANNEL_NAME) as ForumChannel | undefined;
    if (epilogueChannel) {
      const epilogueTagIds = threadTagNames
        .map(name => epilogueChannel.availableTags?.find(t => t.name === name))
        .filter((t): t is NonNullable<typeof t> => t != null)
        .map(t => t.id);
      const epilogueThread = await epilogueChannel.threads.create({
        name: `${book.title} by ${book.author}`,
        message: { embeds: [buildBookEmbed(book, 'Spoilers welcome — discuss freely once you\'ve finished.')] },
        appliedTags: epilogueTagIds,
      });
      db.update(clubBooks).set({ epilogueThreadId: epilogueThread.id }).where(eq(clubBooks.bookId, book.id)).run();
      epilogueUrl = epilogueThread.url;
    }
  }

  await updateProgressPost(book.id, interaction.guild!);

  // Build a human-readable summary for the admin
  const created = results
    .filter((r): r is PromiseFulfilledResult<{ username: string; status: string }> => r.status === 'fulfilled')
    .map(r => r.value.username);
  const failures = results
    .map((r, i) => ({ r, mc: allMemberChannels[i] }))
    .filter(({ r }) => r.status === 'rejected') as Array<{ r: PromiseRejectedResult; mc: typeof allMemberChannels[number] }>;

  const monthYearStr = (month && year) ? ` (${MONTHS[month - 1]} ${year})` : '';
  const statusStr = (month && year)
    ? 'is now the active Book of the Month.'
    : 'is now an active club read (no BOTM month assigned — will not appear in BOTM stats).';
  const lines = [`**${book.title}**${monthYearStr} ${statusStr}`];
  if (created.length) lines.push(`Threads created for: ${created.join(', ')}`);
  if (epilogueUrl) lines.push(`Epilogue thread: ${epilogueUrl}`);
  if (failures.length) {
    for (const { r, mc } of failures) {
      await botLog(interaction.guild!, `[club-start] failed for ${mc.username} (channel ${mc.channelId}): ${(r.reason as Error)?.message ?? String(r.reason)}`);
      lines.push(`⚠️ Failed for **${mc.username}**: ${(r.reason as Error)?.message ?? String(r.reason)}`);
    }
  }

  await interaction.editReply(lines.join('\n'));

  const logParts = [`[club-start] **${book.title}** by ${book.author}`];
  if (created.length) logParts.push(`threads created: ${created.join(', ')}`);
  if (failures.length) logParts.push(`failed: ${failures.map(({ mc }) => mc.username).join(', ')}`);
  await botLog(interaction.guild!, logParts.join(' — '));
}
