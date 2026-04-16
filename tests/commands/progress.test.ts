// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockFindFirst = jest.fn();
const mockGet = jest.fn();
const mockRun = jest.fn().mockReturnValue({ changes: 1 });

jest.mock('../../db', () => {
  const chain: any = {
    from:  jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    set:   jest.fn().mockReturnThis(),
    get:   mockGet,
    run:   mockRun,
  };
  return {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    query: {
      readingLogs: { findFirst: mockFindFirst },
    },
  };
});
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/progress');

const BOOK_WITH_PAGES = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', goodreadsUrl: 'https://www.goodreads.com/book/show/4671', pages: 180 };
const BOOK_NO_PAGES = { title: 'Some Book', goodreadsUrl: 'https://www.goodreads.com/book/show/1', pages: null };
const LOG = { userId: '999', bookId: 1, status: 'reading', progress: 0, startedAt: new Date(), book: BOOK_WITH_PAGES };

function makeBotChannel(extraTags: Array<{ id: string; name: string }> = []) {
  return {
    send: jest.fn().mockResolvedValue(undefined),
    setAppliedTags: jest.fn().mockResolvedValue(undefined),
    parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }, ...extraTags] },
    appliedTags: ['tag-bot'],
  };
}

function makeInteraction({ page = null as number | null, percentage = null as number | null, channelId = 'thread-123', channel = makeBotChannel() } = {}) {
  return {
    channelId,
    channel,
    guild: { channels: { cache: { find: jest.fn().mockReturnValue(null) } }, guildId: 'guild-123' },
    guildId: 'guild-123',
    user: { id: '999', username: 'alice' },
    options: {
      getInteger: jest.fn().mockReturnValue(page),
      getNumber:  jest.fn().mockReturnValue(percentage),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => jest.clearAllMocks());

describe('/progress execute', () => {
  describe('option validation', () => {
    test('replies with error when neither page nor percentage provided', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('page') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('replies with error when both page and percentage provided', async () => {
      const interaction = makeInteraction({ page: 50, percentage: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not both') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('thread routing', () => {
    test('replies with error when not in a book thread', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('book threads') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('replies with error when book is already finished', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, status: 'finished' });
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as finished') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('page option', () => {
    test('replies with error when page given but book has no known page count', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, book: BOOK_NO_PAGES });
      const interaction = makeInteraction({ page: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('percentage') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('replies with error when page exceeds book length', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 999 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('180 pages') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('accepts page equal to book length (triggers finish)', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValueOnce(undefined); // no club book
      const interaction = makeInteraction({ page: 180 });
      await execute(interaction);

      expect(db.update).toHaveBeenCalled();
    });

    test('stores progress as percentage when page given', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 90 });
      await execute(interaction);

      expect(db.update).toHaveBeenCalled();
    });

    test('posts page / total display in thread', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 90 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('90 / 180')
      );
    });
  });

  describe('percentage option', () => {
    test('stores percentage directly', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ percentage: 42.5 });
      await execute(interaction);

      expect(db.update).toHaveBeenCalled();
    });

    test('posts percentage display in thread', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ percentage: 42.5 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('42.5%')
      );
    });
  });

  describe('successful update', () => {
    test('sends ephemeral confirmation', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ percentage: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });
  });

  describe('Completed tag on finish', () => {
    test('applies Completed tag when it exists on the parent channel', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValueOnce(undefined); // no club book
      const channel = makeBotChannel([{ id: 'tag-completed', name: 'Completed' }]);
      const interaction = makeInteraction({ percentage: 100, channel });
      await execute(interaction);

      expect(channel.setAppliedTags).toHaveBeenCalledWith(
        expect.arrayContaining(['tag-bot', 'tag-completed'])
      );
    });

    test('does not call setAppliedTags when Completed tag is absent', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValueOnce(undefined); // no club book
      const channel = makeBotChannel(); // no Completed tag
      const interaction = makeInteraction({ percentage: 100, channel });
      await execute(interaction);

      expect(channel.setAppliedTags).not.toHaveBeenCalled();
    });

    test('command still completes if setAppliedTags rejects', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValueOnce(undefined); // no club book
      const channel = makeBotChannel([{ id: 'tag-completed', name: 'Completed' }]);
      channel.setAppliedTags.mockRejectedValue(new Error('Missing Permissions'));
      const interaction = makeInteraction({ percentage: 100, channel });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('finished') })
      );
    });
  });
});
