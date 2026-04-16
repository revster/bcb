jest.mock('../../db', () => ({
  readingLog: { findUnique: jest.fn(), update: jest.fn() },
  clubBook: { findUnique: jest.fn() },
}));
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/progress');

const BOOK_WITH_PAGES = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', goodreadsUrl: 'https://www.goodreads.com/book/show/4671', pages: 180 };
const BOOK_NO_PAGES = { title: 'Some Book', goodreadsUrl: 'https://www.goodreads.com/book/show/1', pages: null };
const LOG = { userId: '999', bookId: 1, status: 'reading', progress: 0, startedAt: new Date(), book: BOOK_WITH_PAGES };

// Channel that passes the bot-managed thread guard
function makeBotChannel() {
  return {
    send: jest.fn().mockResolvedValue(undefined),
    parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }] },
    appliedTags: ['tag-bot'],
  };
}

function makeInteraction({ page = null as number | null, percentage = null as number | null, channelId = 'thread-123' } = {}) {
  return {
    channelId,
    channel: makeBotChannel(),
    guild: { channels: { cache: { find: jest.fn().mockReturnValue(null) } }, guildId: 'guild-123' },
    guildId: 'guild-123',
    user: { id: '999', username: 'alice' },
    options: {
      getInteger: jest.fn().mockReturnValue(page),
      getNumber: jest.fn().mockReturnValue(percentage),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/progress execute', () => {
  describe('option validation', () => {
    test('replies with error when neither page nor percentage provided', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('page') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('replies with error when both page and percentage provided', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 50, percentage: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not both') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });
  });

  describe('thread routing', () => {
    test('replies with error when not in a book thread', async () => {
      db.readingLog.findUnique.mockResolvedValue(null);
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('book threads') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('replies with error when book is already finished', async () => {
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, status: 'finished' });
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as finished') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });
  });

  describe('page option', () => {
    test('replies with error when page given but book has no known page count', async () => {
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, book: BOOK_NO_PAGES });
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('percentage') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('replies with error when page exceeds book length', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 999 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('180 pages') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('accepts page equal to book length (triggers finish)', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      db.clubBook.findUnique.mockResolvedValue(null);
      const interaction = makeInteraction({ page: 180 });
      await execute(interaction);

      expect(db.readingLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'finished', progress: 100 }) })
      );
    });

    test('stores progress as percentage when page given', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction({ page: 90 });
      await execute(interaction);

      expect(db.readingLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 50 }) })
      );
    });

    test('posts page / total display in thread', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction({ page: 90 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('90 / 180')
      );
    });
  });

  describe('percentage option', () => {
    test('stores percentage directly', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction({ percentage: 42.5 });
      await execute(interaction);

      expect(db.readingLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 42.5 }) })
      );
    });

    test('posts percentage display in thread', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction({ percentage: 42.5 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('42.5%')
      );
    });
  });

  describe('successful update', () => {
    test('sends ephemeral confirmation', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction({ percentage: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });
  });
});
