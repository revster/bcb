jest.mock('../../lib/scrapeBook');
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));
const scrapeBook = require('../../lib/scrapeBook');
const { execute } = require('../../commands/test');

function makeInteraction(url) {
  return {
    options: { getString: jest.fn().mockReturnValue(url) },
    user: { id: '999', username: 'testuser' },
    guild: { channels: { cache: { find: jest.fn().mockReturnValue(null) } } },
    reply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

const VALID_URL = 'https://www.goodreads.com/book/show/4671.The_Great_Gatsby';
const SCRAPED_BOOK = {
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  rating: '3.93 / 5',
  pages: 180,
  image: 'https://example.com/cover.jpg',
  genres: ['Fiction', 'Classics'],
};

afterEach(() => jest.resetAllMocks());

describe('/read execute', () => {
  test('rejects non-Goodreads URLs with an ephemeral reply', async () => {
    const interaction = makeInteraction('https://amazon.com/book/123');
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('valid Goodreads book URL') })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('defers reply then edits with an embed on success', async () => {
    scrapeBook.mockResolvedValue(SCRAPED_BOOK);
    const interaction = makeInteraction(VALID_URL);
    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  test('edits reply with an error message when scraping fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    scrapeBook.mockRejectedValue(new Error('Could not find book metadata on page'));
    const interaction = makeInteraction(VALID_URL);
    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Could not fetch book info')
    );
  });
});
