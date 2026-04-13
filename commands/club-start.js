/**
 * commands/club-start.js — /club-start <url>
 *
 * Admin-only. Designates a Goodreads book as the active club read:
 *   1. Upserts the Book + ClubBook records.
 *   2. Creates a thread in every registered member's personal forum channel,
 *      applying the "Bot" and "Book Club Book" tags if they exist on that channel.
 *   3. Creates a ReadingLog for each new thread.
 *   4. Creates or refreshes the #progress channel post.
 *
 * Always creates a new thread per member, even if one already exists for this book.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const scrapeBook = require('../lib/scrapeBook');
const { updateProgressPost } = require('../lib/progressPost');
const { botLog } = require('../lib/botLog');

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;
const CLUB_TAG_NAMES = ['Bot', 'Book Club Book'];
const EPILOGUE_CHANNEL_NAME = 'epilogue';

function buildOpeningEmbed(book) {
  const embed = new EmbedBuilder()
    .setTitle(book.title)
    .setURL(book.goodreadsUrl)
    .setAuthor({ name: book.author })
    .setDescription(`Started reading on ${new Date().toDateString()}`);

  if (book.image) embed.setThumbnail(book.image);
  if (book.rating) embed.addFields({ name: 'Goodreads Rating', value: book.rating, inline: true });
  if (book.pages) embed.addFields({ name: 'Pages', value: String(book.pages), inline: true });

  const genres = book.genres ? JSON.parse(book.genres) : [];
  if (genres.length) embed.addFields({ name: 'Genres', value: genres.slice(0, 5).join(', ') });

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('club-start')
    .setDescription('Mark a book as the active club read — creates threads for all registered members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('url').setDescription('Goodreads book URL').setRequired(true)
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');

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
      update: {},
      create: { bookId: book.id },
    });

    // Create a thread in every registered member's forum channel
    const memberChannels = await db.memberChannel.findMany();
    const embed = buildOpeningEmbed(book);

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
        const botTagId = epilogueChannel.availableTags?.find(t => t.name === 'Bot')?.id;
        const epilogueThread = await epilogueChannel.threads.create({
          name: `${book.title} by ${book.author}`,
          message: { content: `Spoilers welcome! Discuss **${book.title}** here once you've finished.` },
          ...(botTagId ? { appliedTags: [botTagId] } : {}),
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

    const lines = [`**${book.title}** is now the active club read.`];
    if (created.length) lines.push(`Threads created for: ${created.join(', ')}`);
    if (epilogueUrl) lines.push(`Epilogue thread: ${epilogueUrl}`);
    if (failures.length) {
      for (const { r, mc } of failures) {
        console.error(`club-start: failed for ${mc.username} (channel ${mc.channelId}):`, r.reason);
        lines.push(`⚠️ Failed for **${mc.username}**: ${r.reason?.message ?? r.reason}`);
      }
    }

    await interaction.editReply(lines.join('\n'));

    const logParts = [`[club-start] **${book.title}** by ${book.author}`];
    if (created.length) logParts.push(`threads created: ${created.join(', ')}`);
    if (failures.length) logParts.push(`failed: ${failures.map(({ mc }) => mc.username).join(', ')}`);
    await botLog(interaction.guild, logParts.join(' — '));
  },
};
