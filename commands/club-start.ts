/**
 * commands/club-start.js — /club-start <url> [month] [year]
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

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const scrapeBook = require('../lib/scrapeBook');
const { buildBookEmbed } = require('../lib/buildBookEmbed');
const { updateProgressPost } = require('../lib/progressPost');
const { botLog } = require('../lib/botLog');

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;
const CLUB_TAG_NAMES = ['Bot', 'Book of the Month'];
const EPILOGUE_CHANNEL_NAME = 'epilogue';
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


module.exports = {
  data: new SlashCommandBuilder()
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
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');
    const month = interaction.options.getInteger('month');
    const year = interaction.options.getInteger('year');

    if (!GOODREADS_BOOK_RE.test(url)) {
      await interaction.reply({
        content: 'Please provide a valid Goodreads book URL (e.g. `https://www.goodreads.com/book/show/...`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Find existing book record or scrape it fresh
    let book = await db.book.findUnique({ where: { goodreadsUrl: url } });
    if (!book) {
      const scraped = await scrapeBook(url).catch(() => null);
      if (!scraped) {
        await interaction.editReply('Could not fetch book info from Goodreads. Check the URL and try again.');
        return;
      }
      const { title, author, rating, pages, image, genres } = scraped;
      book = await db.book.upsert({
        where: { goodreadsUrl: url },
        update: { title, author, rating, pages, image, genres: JSON.stringify(genres) },
        create: { title, author, rating, pages, image, genres: JSON.stringify(genres), goodreadsUrl: url },
      });
    }

    const clubBook = await db.clubBook.upsert({
      where: { bookId: book.id },
      update: { ...(month !== null && { month }), ...(year !== null && { year }) },
      create: { bookId: book.id, month, year },
    });

    // Create a thread in every registered member's forum channel
    const memberChannels = await db.memberChannel.findMany();
    const embed = buildBookEmbed(book, `Started reading on ${new Date().toDateString()}`);

    const results = await Promise.allSettled(
      memberChannels.map(async mc => {
        const forumChannel = await interaction.guild.channels.fetch(mc.channelId);

        // Collect tag IDs for any matching tag names that exist on this channel
        const appliedTags = CLUB_TAG_NAMES
          .map(name => forumChannel.availableTags?.find(t => t.name === name))
          .filter(Boolean)
          .map(t => t.id);

        const threadOptions = {
          name: `${book.title} by ${book.author}`,
          message: { embeds: [embed] },
        };

        const thread = await forumChannel.threads.create({ ...threadOptions, appliedTags });

        await db.readingLog.create({
          data: { userId: mc.userId, bookId: book.id, threadId: thread.id },
        });

        return { username: mc.username, status: 'created' };
      })
    );

    // Create the epilogue discussion thread if it doesn't already exist
    let epilogueUrl = null;
    if (!clubBook.epilogueThreadId) {
      const epilogueChannel = interaction.guild.channels.cache.find(c => c.name === EPILOGUE_CHANNEL_NAME);
      if (epilogueChannel) {
        const epilogueTagIds = CLUB_TAG_NAMES
          .map(name => epilogueChannel.availableTags?.find(t => t.name === name))
          .filter(Boolean)
          .map(t => t.id);
        const epilogueThread = await epilogueChannel.threads.create({
          name: `${book.title} by ${book.author}`,
          message: { embeds: [buildBookEmbed(book, 'Spoilers welcome — discuss freely once you\'ve finished.')] },
          appliedTags: epilogueTagIds,
        });
        await db.clubBook.update({
          where: { bookId: book.id },
          data: { epilogueThreadId: epilogueThread.id },
        });
        epilogueUrl = epilogueThread.url;
      }
    }

    await updateProgressPost(book.id, interaction.guild);

    // Build a human-readable summary for the admin
    const created = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.username);
    const failures = results
      .map((r, i) => ({ r, mc: memberChannels[i] }))
      .filter(({ r }) => r.status === 'rejected');

    const monthYearStr = (month && year) ? ` (${MONTHS[month - 1]} ${year})` : '';
    const lines = [`**${book.title}**${monthYearStr} is now the active club read.`];
    if (created.length) lines.push(`Threads created for: ${created.join(', ')}`);
    if (epilogueUrl) lines.push(`Epilogue thread: ${epilogueUrl}`);
    if (failures.length) {
      for (const { r, mc } of failures) {
        console.error(`club-start: failed for ${mc.username} (channel ${mc.channelId}):`, r.reason);
        lines.push(`⚠️ Failed for **${mc.username}**: ${r.reason?.message ?? String(r.reason)}`);
      }
    }

    await interaction.editReply(lines.join('\n'));

    const logParts = [`[club-start] **${book.title}** by ${book.author}`];
    if (created.length) logParts.push(`threads created: ${created.join(', ')}`);
    if (failures.length) logParts.push(`failed: ${failures.map(({ mc }) => mc.username).join(', ')}`);
    await botLog(interaction.guild, logParts.join(' — '));
  },
};
