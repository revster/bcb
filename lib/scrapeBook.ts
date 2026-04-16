const cheerio = require('cheerio');

async function scrapeBook(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) throw new Error(`Goodreads returned ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  let bookData = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html());
      if (parsed['@type'] === 'Book') bookData = parsed;
    } catch {
      // skip malformed script tags
    }
  });

  if (!bookData) throw new Error('Could not find book metadata on page');

  // Goodreads JSON-LD contains HTML-encoded strings — decode them through cheerio
  const decodeEntities = str => str ? $('<textarea>').html(str).text() : str;

  const title = decodeEntities(bookData.name);
  const author = Array.isArray(bookData.author)
    ? bookData.author.map(a => decodeEntities(a.name)).join(', ')
    : decodeEntities(bookData.author?.name);

  if (!title || !author) throw new Error('Missing title or author in metadata');

  const rating = bookData.aggregateRating?.ratingValue
    ? `${parseFloat(bookData.aggregateRating.ratingValue).toFixed(2)} / 5`
    : null;
  const pages = bookData.numberOfPages ?? null;
  const image = bookData.image ?? null;

  // Genres are not in the JSON-LD — scrape from HTML
  const genres = [];
  $('a[href*="/genres/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name) genres.push(name);
  });
  const uniqueGenres = [...new Set(genres)];

  return { title, author, rating, pages, image, genres: uniqueGenres };
}

module.exports = scrapeBook;
