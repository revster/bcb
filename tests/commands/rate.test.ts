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
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/rate');

const BOOK = { title: 'The Great Gatsby' };
const LOG = { userId: '999', bookId: 1, status: 'reading', book: BOOK };

const BOT_CHANNEL = {
  send: jest.fn().mockResolvedValue(undefined),
  parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }] },
  appliedTags: ['tag-bot'],
};

function makeInteraction(rating = 4, channelId = 'thread-123') {
  return {
    channelId,
    channel: BOT_CHANNEL,
    guild: { channels: { cache: { find: jest.fn().mockReturnValue(null) } } },
    user: { id: '999', username: 'alice' },
    options: { getNumber: jest.fn().mockReturnValue(rating) },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => jest.clearAllMocks());

describe('/rate execute', () => {
  test('replies with error when not in a book thread', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('book threads') })
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  test('saves rating to reading log', async () => {
    mockFindFirst.mockResolvedValue(LOG);
    mockGet.mockReturnValueOnce(undefined); // no club book
    const interaction = makeInteraction(4);
    await execute(interaction);

    expect(db.update).toHaveBeenCalled();
  });

  test('posts whole stars in thread for integer rating', async () => {
    mockFindFirst.mockResolvedValue(LOG);
    mockGet.mockReturnValueOnce(undefined); // no club book
    const interaction = makeInteraction(3);
    await execute(interaction);

    expect(BOT_CHANNEL.send).toHaveBeenCalledWith('⭐⭐⭐');
  });

  test('posts stars with half symbol for .5 rating', async () => {
    mockFindFirst.mockResolvedValue(LOG);
    mockGet.mockReturnValueOnce(undefined); // no club book
    const interaction = makeInteraction(4.5);
    await execute(interaction);

    expect(BOT_CHANNEL.send).toHaveBeenCalledWith('⭐⭐⭐⭐½');
  });

  test('sends ephemeral confirmation', async () => {
    mockFindFirst.mockResolvedValue(LOG);
    mockGet.mockReturnValueOnce(undefined); // no club book
    const interaction = makeInteraction(5);
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  test('ephemeral reply includes numeric rating', async () => {
    mockFindFirst.mockResolvedValue(LOG);
    mockGet.mockReturnValueOnce(undefined); // no club book
    const interaction = makeInteraction(4.5);
    await execute(interaction);

    const content = interaction.reply.mock.calls[0][0].content;
    expect(content).toContain('4.5');
  });
});
