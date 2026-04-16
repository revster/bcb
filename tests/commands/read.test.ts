jest.mock('../../db', () => ({
  memberChannel: { findUnique: jest.fn() },
  book: { upsert: jest.fn() },
  readingLog: { create: jest.fn() },
}));
import scrapeBook from '../../lib/scrapeBook';
jest.mock('../../lib/scrapeBook');
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/read');

const VALID_URL = 'https://www.goodreads.com/book/show/4671.The_Great_Gatsby';
const SCRAPED_BOOK = {
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  rating: '3.93 / 5',
  pages: 180,
  image: 'https://example.com/cover.jpg',
  genres: ['Fiction', 'Classics'],
};
const UPSERTED_BOOK = { id: 42, ...SCRAPED_BOOK, goodreadsUrl: VALID_URL };
const MEMBER_CHANNEL = { userId: '999', channelId: 'ch-forum' };
const THREAD = { id: 'thread-123', url: 'https://discord.com/channels/1/2/thread-123' };

function makeForumChannel() {
  return {
    threads: { create: jest.fn().mockResolvedValue(THREAD) },
  };
}

function makeInteraction(url = VALID_URL, { forumChannel = makeForumChannel() } = {}) {
  return {
    options: { getString: jest.fn().mockReturnValue(url) },
    user: { id: '999', displayName: 'TestUser', username: 'testuser' },
    guild: { channels: { fetch: jest.fn().mockResolvedValue(forumChannel), cache: { find: jest.fn() } } },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/read execute', () => {
  describe('URL validation', () => {
    test('rejects a non-Goodreads URL', async () => {
      const interaction = makeInteraction('https://amazon.com/book/123');
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('valid Goodreads book URL') })
      );
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    test('rejects a Goodreads URL that is not a book page', async () => {
      const interaction = makeInteraction('https://www.goodreads.com/author/show/3190');
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('valid Goodreads book URL') })
      );
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe('scrape failure', () => {
    test('replies with error when scraping fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.mocked(scrapeBook).mockRejectedValue(new Error('Goodreads returned 404'));
      db.memberChannel.findUnique.mockResolvedValue(MEMBER_CHANNEL);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch book info')
      );
      expect(db.book.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unregistered member', () => {
    test('replies with register prompt when no MemberChannel exists', async () => {
      jest.mocked(scrapeBook).mockResolvedValue(SCRAPED_BOOK);
      db.memberChannel.findUnique.mockResolvedValue(null);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('/register')
      );
      expect(db.book.upsert).not.toHaveBeenCalled();
    });
  });

  describe('successful start', () => {
    beforeEach(() => {
      jest.mocked(scrapeBook).mockResolvedValue(SCRAPED_BOOK);
      db.memberChannel.findUnique.mockResolvedValue(MEMBER_CHANNEL);
      db.book.upsert.mockResolvedValue(UPSERTED_BOOK);
      db.readingLog.create.mockResolvedValue({});
    });

    test('defers ephemerally', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    test('fetches the forum channel by stored channelId', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('ch-forum');
    });

    test('upserts the book by goodreadsUrl', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.book.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { goodreadsUrl: VALID_URL } })
      );
    });

    test('creates a thread in the forum channel', async () => {
      const forum = makeForumChannel();
      const interaction = makeInteraction(VALID_URL, { forumChannel: forum });
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('The Great Gatsby') })
      );
    });

    test('creates a ReadingLog with the thread id', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.readingLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: '999', bookId: 42, threadId: 'thread-123' }),
        })
      );
    });

    test('editReply links to the new thread', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('The Great Gatsby')
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining(THREAD.url)
      );
    });
  });
});
