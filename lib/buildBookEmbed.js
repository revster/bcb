/**
 * lib/buildBookEmbed.js
 *
 * Single source of truth for the book info embed used by /read, /club-start
 * (member threads + epilogue thread), /abandon, and progressPost.js.
 *
 * Accepts either a DB Book record (genres as a JSON string) or a raw scraped
 * object (genres as an array). goodreadsUrl must be present in either form.
 */

const { EmbedBuilder } = require('discord.js');

/**
 * @param {object} book
 * @param {string} book.title
 * @param {string} book.goodreadsUrl
 * @param {string} book.author
 * @param {string|null} [book.image]
 * @param {string|null} [book.rating]
 * @param {number|null} [book.pages]
 * @param {string[]|string|null} [book.genres]  array or JSON string
 * @param {string|null} [description]  optional embed description
 * @returns {EmbedBuilder}
 */
function buildBookEmbed(book, description = null) {
  const embed = new EmbedBuilder()
    .setTitle(book.title)
    .setURL(book.goodreadsUrl)
    .setAuthor({ name: book.author });

  if (description) embed.setDescription(description);
  if (book.image) embed.setThumbnail(book.image);
  if (book.rating) embed.addFields({ name: 'Goodreads Rating', value: book.rating, inline: true });
  if (book.pages) embed.addFields({ name: 'Pages', value: String(book.pages), inline: true });

  let genres = [];
  if (Array.isArray(book.genres)) {
    genres = book.genres;
  } else if (book.genres) {
    try { genres = JSON.parse(book.genres); } catch { /* malformed — skip genres */ }
  }
  if (genres.length) embed.addFields({ name: 'Genres', value: genres.slice(0, 5).join(', ') });

  return embed;
}

module.exports = { buildBookEmbed };
