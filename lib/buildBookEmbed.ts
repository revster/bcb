/**
 * lib/buildBookEmbed.ts
 *
 * Single source of truth for the book info embed used by /read, /club-start
 * (member threads + epilogue thread), /abandon, and progressPost.ts.
 *
 * Accepts either a DB Book record (genres as a JSON string) or a raw scraped
 * object (genres as an array). goodreadsUrl must be present in either form.
 */

import { EmbedBuilder } from 'discord.js';

export interface BookLike {
  title: string;
  goodreadsUrl: string;
  author: string;
  image?: string | null;
  rating?: string | null;
  pages?: number | null;
  genres?: string[] | string | null;
}

export function buildBookEmbed(book: BookLike, description: string | null = null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(book.title)
    .setURL(book.goodreadsUrl)
    .setAuthor({ name: book.author });

  if (description) embed.setDescription(description);
  if (book.image) embed.setThumbnail(book.image);
  if (book.rating) embed.addFields({ name: 'Goodreads Rating', value: book.rating, inline: true });
  if (book.pages) embed.addFields({ name: 'Pages', value: String(book.pages), inline: true });

  let genres: string[] = [];
  if (Array.isArray(book.genres)) {
    genres = book.genres;
  } else if (book.genres) {
    try { genres = JSON.parse(book.genres); } catch { /* malformed — skip genres */ }
  }
  if (genres.length) embed.addFields({ name: 'Genres', value: genres.slice(0, 5).join(', ') });

  return embed;
}
