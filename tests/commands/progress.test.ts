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
jest.mock('../../lib/progressPost', () => ({
  updateProgressPost: jest.fn(),
  buildBar: jest.fn().mockReturnValue('████████████░░░░░░░░'),
}));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/progress');

const BOOK_WITH_PAGES = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', goodreadsUrl: 'https://www.goodreads.com/book/show/4671', pages: 180 };
const BOOK_NO_PAGES = { title: 'Some Book', goodreadsUrl: 'https://www.goodreads.com/book/show/1', pages: null };
const LOG = { id: 1, userId: '999', bookId: 1, status: 'reading', progress: 0, startedAt: new Date(), progressMessageId: null, book: BOOK_WITH_PAGES };

function makeBotChannel(extraTags: Array<{ id: string; name: string }> = []) {
  return {
    send: jest.fn().mockResolvedValue(undefined),
    setAppliedTags: jest.fn().mockResolvedValue(undefined),
    parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }, ...extraTags] },
    appliedTags: ['tag-bot'],
  };
}

function makeProgressChannel() {
  return {
    send: jest.fn().mockResolvedValue({ id: 'new-msg-id' }),
    messages: {
      fetch: jest.fn().mockResolvedValue({ edit: jest.fn().mockResolvedValue(undefined) }),
    },
  };
}

function makeInteraction({
  page = null as number | null,
  percentage = null as number | null,
  channelId = 'thread-123',
  channel = makeBotChannel(),
  progressChannel = undefined as ReturnType<typeof makeProgressChannel> | undefined,
} = {}) {
  return {
    channelId,
    channel,
    guild: {
      channels: {
        fetch: jest.fn().mockResolvedValue({ find: jest.fn().mockReturnValue(progressChannel) }),
        cache: { find: jest.fn() },
      },
      guildId: 'guild-123',
    },
    guildId: 'guild-123',
    user: { id: '999', username: 'alice', displayName: 'Alice' },
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
afterEach(() => {
  mockFindFirst.mockReset();
  mockGet.mockReset();
  mockRun.mockReset();
  jest.clearAllMocks();
});

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

    test('posts progress bar with page info to thread', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ page: 90 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('pg 90/180')
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

    test('posts rounded percentage to thread', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction({ percentage: 42.5 });
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('43%')
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

  describe('resume from abandoned', () => {
    test('removes Abandoned tag when resuming', async () => {
      const channel = {
        send: jest.fn().mockResolvedValue(undefined),
        setAppliedTags: jest.fn().mockResolvedValue(undefined),
        parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }, { id: 'tag-abandoned', name: 'Abandoned' }] },
        appliedTags: ['tag-bot', 'tag-abandoned'],
      };
      mockFindFirst.mockResolvedValue({ ...LOG, status: 'abandoned', progress: 30 });
      const interaction = makeInteraction({ percentage: 50, channel });
      await execute(interaction);

      expect(channel.setAppliedTags).toHaveBeenCalledWith(['tag-bot']);
    });

    test('does not call setAppliedTags when Abandoned tag is absent', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, status: 'abandoned', progress: 30 });
      const channel = makeBotChannel(); // no Abandoned tag
      const interaction = makeInteraction({ percentage: 50, channel });
      await execute(interaction);

      expect(channel.setAppliedTags).not.toHaveBeenCalled();
    });

    test('does not remove tags when not resuming', async () => {
      mockFindFirst.mockResolvedValue(LOG); // status: 'reading', not abandoned
      const channel = makeBotChannel([{ id: 'tag-abandoned', name: 'Abandoned' }]);
      const interaction = makeInteraction({ percentage: 50, channel });
      await execute(interaction);

      expect(channel.setAppliedTags).not.toHaveBeenCalled();
    });
  });

  describe('#progress post for personal books', () => {
    test('posts to #progress when no progressMessageId', async () => {
      mockFindFirst.mockResolvedValue(LOG); // progressMessageId: null
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ percentage: 50, progressChannel: pc });
      await execute(interaction);

      expect(pc.send).toHaveBeenCalledWith(expect.stringContaining('Alice'));
    });

    test('saves progressMessageId on reading log after new post', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ percentage: 50, progressChannel: pc });
      await execute(interaction);

      // db.update called twice: once for progress, once for progressMessageId
      expect(db.update).toHaveBeenCalledTimes(2);
    });

    test('edits existing #progress message when progressMessageId is set', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, progressMessageId: 'existing-msg-id' });
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ percentage: 50, progressChannel: pc });
      await execute(interaction);

      expect(pc.messages.fetch).toHaveBeenCalledWith('existing-msg-id');
      expect(pc.send).not.toHaveBeenCalled();
    });

    test('sends new message when existing one was deleted', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, progressMessageId: 'deleted-msg-id' });
      const pc = makeProgressChannel();
      pc.messages.fetch = jest.fn().mockRejectedValue(new Error('Unknown Message'));
      const interaction = makeInteraction({ percentage: 50, progressChannel: pc });
      await execute(interaction);

      expect(pc.send).toHaveBeenCalled();
    });

    test('does not post to #progress for club books', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValue({ id: 99, bookId: 1 }); // club book exists
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ percentage: 50, progressChannel: pc });
      await execute(interaction);

      expect(pc.send).not.toHaveBeenCalled();
    });

    test('skips #progress post gracefully when channel not found', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      // no progressChannel passed → find returns undefined
      const interaction = makeInteraction({ percentage: 50 });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });
  });
});
