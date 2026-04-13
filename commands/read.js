/**
 * commands/read.js — /read <url>
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

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const scrapeBook = require('../lib/scrapeBook');
const { updateProgressPost } = require('../lib/progressPost');
const { botLog } = require('../lib/botLog');

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('read')
    .setDescription('Start tracking a book — creates a thread in your reading channel')
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

    // Defer ephemerally — scraping + channel ops can take a few seconds
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const bookData = await scrapeBook(url).catch(err => {
      console.error('scrapeBook error:', err);
      return null;
    });

    if (!bookData) {
      await interaction.editReply('Could not fetch book info. The Goodreads link may be invalid or the page is unavailable.');
      return;
    }

    const { title, author, rating, pages, image, genres } = bookData;

    // Look up the member's registered forum channel
    const memberChannel = await db.memberChannel.findUnique({
      where: { userId: interaction.user.id },
    });

    if (!memberChannel) {
      await interaction.editReply("Your reading channel hasn't been registered yet. Ask an admin to use `/register`.");
      return;
    }

    // Fetch the forum channel from Discord
    const forumChannel = await interaction.guild.channels.fetch(memberChannel.channelId);

    // Upsert the book record
    const book = await db.book.upsert({
      where: { goodreadsUrl: url },
      update: { title, author, rating, pages, image, genres: JSON.stringify(genres) },
      create: { title, author, rating, pages, image, genres: JSON.stringify(genres), goodreadsUrl: url },
    });

    // Build the opening embed posted as the thread's first message
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(url)
      .setAuthor({ name: author })
      .setDescription(`Started reading on ${new Date().toDateString()}`);

    if (image) embed.setThumbnail(image);
    if (rating) embed.addFields({ name: 'Goodreads Rating', value: rating, inline: true });
    if (pages) embed.addFields({ name: 'Pages', value: String(pages), inline: true });
    if (genres.length) embed.addFields({ name: 'Genres', value: genres.slice(0, 5).join(', ') });

    // Create the thread in the member's forum channel
    const thread = await forumChannel.threads.create({
      name: `${title} by ${author}`,
      message: { embeds: [embed] },
    });

    // Open the reading log
    await db.readingLog.create({
      data: {
        userId: interaction.user.id,
        bookId: book.id,
        threadId: thread.id,
      },
    });

    await interaction.editReply(`Your thread for **${title}** is live! [Jump to thread](${thread.url})`);
    await botLog(interaction.guild, `[read] ${interaction.user.username} started **${title}** by ${author}`);

    await updateProgressPost(book.id, interaction.guild);
  },
};
