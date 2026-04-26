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
const { execute } = require('../../commands/abandon');

const BOOK = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', goodreadsUrl: 'https://www.goodreads.com/book/show/4671', pages: 180 };
const LOG  = { id: 1, userId: '999', bookId: 1, status: 'reading', progress: 50, progressMessageId: null, book: BOOK };

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
  channelId = 'thread-123',
  channel = makeBotChannel(),
  progressChannel = undefined as ReturnType<typeof makeProgressChannel> | undefined,
} = {}) {
  return {
    channelId,
    channel,
    guild: {
      id: 'guild-1',
      channels: {
        fetch: jest.fn().mockResolvedValue({ find: jest.fn().mockReturnValue(progressChannel) }),
      },
    },
    user: { id: '999', username: 'alice', displayName: 'Alice' },
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

describe('/abandon execute', () => {
  describe('guards', () => {
    test('rejects when not in a bot-managed thread', async () => {
      const channel = {
        send: jest.fn(),
        setAppliedTags: jest.fn(),
        parent: { availableTags: [{ id: 'tag-other', name: 'Other' }] },
        appliedTags: [],
      };
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('bot-managed') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('rejects when no reading log found for thread', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('book threads') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('rejects when log belongs to a different user', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, userId: 'other-user' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('your own') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('rejects when book is already finished', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, status: 'finished' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as finished') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    test('rejects when book is already abandoned', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, status: 'abandoned' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as abandoned') })
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('successful abandon', () => {
    test('updates status to abandoned in the database', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.update).toHaveBeenCalled();
    });

    test('sends an embed in the thread showing progress at abandonment', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.arrayContaining([expect.anything()]) })
      );
    });

    test('replies ephemerally confirming abandonment', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('abandoned'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    test('shows page number in embed description when book has pages', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, progress: 50 });
      const interaction = makeInteraction();
      await execute(interaction);

      // 50% of 180 pages = page 90
      const embedDescription = interaction.channel.send.mock.calls[0][0].embeds[0].data.description;
      expect(embedDescription).toContain('page 90 / 180');
    });

    test('shows percentage in embed description when book has no pages', async () => {
      const bookNoPages = { ...BOOK, pages: null };
      mockFindFirst.mockResolvedValue({ ...LOG, progress: 33, book: bookNoPages });
      const interaction = makeInteraction();
      await execute(interaction);

      const embedDescription = interaction.channel.send.mock.calls[0][0].embeds[0].data.description;
      expect(embedDescription).toContain('33%');
    });
  });

  describe('Abandoned tag', () => {
    test('applies Abandoned tag when it exists on the parent channel', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const channel = makeBotChannel([{ id: 'tag-abandoned', name: 'Abandoned' }]);
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(channel.setAppliedTags).toHaveBeenCalledWith(
        expect.arrayContaining(['tag-bot', 'tag-abandoned'])
      );
    });

    test('does not call setAppliedTags when Abandoned tag is absent', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const channel = makeBotChannel(); // no Abandoned tag
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(channel.setAppliedTags).not.toHaveBeenCalled();
    });

    test('command still completes if setAppliedTags rejects', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const channel = makeBotChannel([{ id: 'tag-abandoned', name: 'Abandoned' }]);
      channel.setAppliedTags.mockRejectedValue(new Error('Missing Permissions'));
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('abandoned') })
      );
    });
  });

  describe('#progress post for personal books', () => {
    test('posts to #progress when no progressMessageId', async () => {
      mockFindFirst.mockResolvedValue(LOG); // progressMessageId: null
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ progressChannel: pc });
      await execute(interaction);

      expect(pc.send).toHaveBeenCalledWith(expect.stringContaining('Alice'));
    });

    test('#progress post includes abandoned marker', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ progressChannel: pc });
      await execute(interaction);

      expect(pc.send).toHaveBeenCalledWith(expect.stringContaining('✗'));
    });

    test('edits existing #progress message when progressMessageId is set', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, progressMessageId: 'existing-msg-id' });
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ progressChannel: pc });
      await execute(interaction);

      expect(pc.messages.fetch).toHaveBeenCalledWith('existing-msg-id');
      expect(pc.send).not.toHaveBeenCalled();
    });

    test('sends new message when existing one was deleted', async () => {
      mockFindFirst.mockResolvedValue({ ...LOG, progressMessageId: 'deleted-msg-id' });
      const pc = makeProgressChannel();
      pc.messages.fetch = jest.fn().mockRejectedValue(new Error('Unknown Message'));
      const interaction = makeInteraction({ progressChannel: pc });
      await execute(interaction);

      expect(pc.send).toHaveBeenCalled();
    });

    test('does not post to #progress for club books', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      mockGet.mockReturnValue({ id: 99, bookId: 1 }); // club book exists
      const pc = makeProgressChannel();
      const interaction = makeInteraction({ progressChannel: pc });
      await execute(interaction);

      expect(pc.send).not.toHaveBeenCalled();
    });

    test('skips #progress post gracefully when channel not found', async () => {
      mockFindFirst.mockResolvedValue(LOG);
      // no progressChannel → find returns undefined
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('abandoned') })
      );
    });
  });
});
