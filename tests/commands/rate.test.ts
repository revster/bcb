jest.mock('../../db', () => ({
  readingLog: { findUnique: jest.fn(), update: jest.fn() },
  clubBook: { findUnique: jest.fn() },
}));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/rate');

const BOOK = { title: 'The Great Gatsby' };
const LOG = { userId: '999', bookId: 1, status: 'reading', book: BOOK };

// Channel that passes the bot-managed thread guard
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

afterEach(() => jest.resetAllMocks());

describe('/rate execute', () => {
  test('replies with error when not in a book thread', async () => {
    db.readingLog.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('book threads') })
    );
    expect(db.readingLog.update).not.toHaveBeenCalled();
  });

  test('saves rating to reading log', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(4);
    await execute(interaction);

    expect(db.readingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rating: 4 }) })
    );
  });

  test('saves decimal rating', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(4.5);
    await execute(interaction);

    expect(db.readingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rating: 4.5 }) })
    );
  });

  test('posts whole stars in thread for integer rating', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(3);
    await execute(interaction);

    expect(BOT_CHANNEL.send).toHaveBeenCalledWith('⭐⭐⭐');
  });

  test('posts stars with half symbol for .5 rating', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(4.5);
    await execute(interaction);

    expect(BOT_CHANNEL.send).toHaveBeenCalledWith('⭐⭐⭐⭐½');
  });

  test('sends ephemeral confirmation', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(5);
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  test('ephemeral reply includes numeric rating', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    db.clubBook.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction(4.5);
    await execute(interaction);

    const content = interaction.reply.mock.calls[0][0].content;
    expect(content).toContain('4.5');
  });
});
