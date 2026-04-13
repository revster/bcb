const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const scrapeBook = require('../lib/scrapeBook');
const { botLog } = require('../lib/botLog');

const GOODREADS_BOOK_RE = /^https:\/\/(www\.)?goodreads\.com\/book\/show\//;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Scrape a Goodreads URL and display its metadata (scraper health check)')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('Goodreads book URL')
        .setRequired(true)
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

    await interaction.deferReply();

    try {
      const { title, author, rating, pages, image, genres } = await scrapeBook(url);

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setURL(url)
        .setAuthor({ name: author });

      if (image) embed.setThumbnail(image);

      if (rating) embed.addFields({ name: 'Rating', value: rating, inline: true });
      if (pages) embed.addFields({ name: 'Pages', value: String(pages), inline: true });
      if (genres.length) embed.addFields({ name: 'Genres', value: genres.slice(0, 5).join(', ') });

      await interaction.editReply({ embeds: [embed] });
      await botLog(interaction.guild, `[test] ${interaction.user.username} scraped **${title}** by ${author}`);
    } catch (err) {
      console.error('scrapeBook error:', err);
      await interaction.editReply('Could not fetch book info. The Goodreads link may be invalid or the page is unavailable.');
    }
  },
};
