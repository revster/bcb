import * as cheerio from 'cheerio';

interface ScrapedBook {
  title: string;
  author: string;
  rating: string | null;
  pages: number | null;
  image: string | null;
  genres: string[];
}

async function scrapeBook(url: string): Promise<ScrapedBook> {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bookData: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() ?? '');
      if (parsed['@type'] === 'Book') bookData = parsed;
    } catch {
      // skip malformed script tags
    }
  });

  if (!bookData) throw new Error('Could not find book metadata on page');

  // Goodreads JSON-LD contains HTML-encoded strings — decode them through cheerio
  const decodeEntities = (str: string | null | undefined): string =>
    str ? $('<textarea>').html(str)?.text() ?? str : '';

  const title = decodeEntities(bookData['name']);
  const author = Array.isArray(bookData['author'])
    ? bookData['author'].map((a: { name: string }) => decodeEntities(a.name)).join(', ')
    : decodeEntities(bookData['author']?.name);

  if (!title || !author) throw new Error('Missing title or author in metadata');

  const rating = bookData['aggregateRating']?.ratingValue
    ? `${parseFloat(bookData['aggregateRating'].ratingValue).toFixed(2)} / 5`
    : null;
  const pages: number | null = bookData['numberOfPages'] ?? null;
  const image: string | null = bookData['image'] ?? null;

  // Genres are not in the JSON-LD — scrape from HTML
  const genres: string[] = [];
  $('a[href*="/genres/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name) genres.push(name);
  });
  const uniqueGenres = [...new Set(genres)];

  return { title, author, rating, pages, image, genres: uniqueGenres };
}

export = scrapeBook;
