import scrapeBook from '../../lib/scrapeBook';

function makeHtml(bookData: unknown, genreLinks: string[] = []) {
  const genreAnchors = genreLinks
    .map(g => `<a href="/genres/${g.toLowerCase()}">${g}</a>`)
    .join('\n');
  return `
    <html><head>
      <script type="application/ld+json">${JSON.stringify(bookData)}</script>
    </head><body>${genreAnchors}</body></html>
  `;
}

function mockFetch(html: string, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(html),
  });
}

const BASE_BOOK = {
  '@type': 'Book',
  name: 'The Great Gatsby',
  author: [{ '@type': 'Person', name: 'F. Scott Fitzgerald' }],
  aggregateRating: { '@type': 'AggregateRating', ratingValue: 3.93 },
  numberOfPages: 180,
  image: 'https://example.com/cover.jpg',
};

afterEach(() => jest.resetAllMocks());

describe('scrapeBook', () => {
  test('extracts title, author, rating, pages, and image', async () => {
    mockFetch(makeHtml(BASE_BOOK));
    const result = await scrapeBook('https://www.goodreads.com/book/show/4671');

    expect(result.title).toBe('The Great Gatsby');
    expect(result.author).toBe('F. Scott Fitzgerald');
    expect(result.rating).toBe('3.93 / 5');
    expect(result.pages).toBe(180);
    expect(result.image).toBe('https://example.com/cover.jpg');
  });

  test('joins multiple authors with commas', async () => {
    const book = {
      ...BASE_BOOK,
      author: [
        { '@type': 'Person', name: 'Author One' },
        { '@type': 'Person', name: 'Author Two' },
      ],
    };
    mockFetch(makeHtml(book));
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');

    expect(result.author).toBe('Author One, Author Two');
  });

  test('handles single author object (not array)', async () => {
    const book = { ...BASE_BOOK, author: { '@type': 'Person', name: 'Solo Author' } };
    mockFetch(makeHtml(book));
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');

    expect(result.author).toBe('Solo Author');
  });

  test('extracts genres from HTML links', async () => {
    mockFetch(makeHtml(BASE_BOOK, ['Fiction', 'Classics', 'Literature']));
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');

    expect(result.genres).toEqual(['Fiction', 'Classics', 'Literature']);
  });

  test('deduplicates genres', async () => {
    mockFetch(makeHtml(BASE_BOOK, ['Fiction', 'Fiction', 'Classics']));
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');

    expect(result.genres).toEqual(['Fiction', 'Classics']);
  });

  test('returns null for optional fields when absent', async () => {
    const book = { '@type': 'Book', name: 'Minimal', author: { '@type': 'Person', name: 'Author' } };
    mockFetch(makeHtml(book));
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');

    expect(result.rating).toBeNull();
    expect(result.pages).toBeNull();
    expect(result.image).toBeNull();
    expect(result.genres).toEqual([]);
  });

  test('throws when Goodreads returns a non-200 status', async () => {
    mockFetch('', 404);
    await expect(scrapeBook('https://www.goodreads.com/book/show/1'))
      .rejects.toThrow('Goodreads returned 404');
  });

  test('throws when no Book JSON-LD is found on the page', async () => {
    mockFetch('<html><body>no metadata here</body></html>');
    await expect(scrapeBook('https://www.goodreads.com/book/show/1'))
      .rejects.toThrow('Could not find book metadata on page');
  });

  test('throws when title or author is missing from metadata', async () => {
    const book = { '@type': 'Book', name: 'No Author' };
    mockFetch(makeHtml(book));
    await expect(scrapeBook('https://www.goodreads.com/book/show/1'))
      .rejects.toThrow('Missing title or author in metadata');
  });

  test('skips malformed JSON-LD script tags without throwing', async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{ invalid json }</script>
        <script type="application/ld+json">${JSON.stringify(BASE_BOOK)}</script>
      </head></html>
    `;
    mockFetch(html);
    const result = await scrapeBook('https://www.goodreads.com/book/show/1');
    expect(result.title).toBe('The Great Gatsby');
  });
});
