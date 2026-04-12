jest.mock('../../db', () => ({
  readingLog: { findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/finish');

const BOOK = {
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  goodreadsUrl: 'https://www.goodreads.com/book/show/4671',
  image: 'https://example.com/cover.jpg',
  pages: 180,
};
const LOG = {
  bookId: 1,
  status: 'reading',
  progress: 75,
  rating: 4,
  startedAt: new Date('2026-01-01'),
  book: BOOK,
};

function makeInteraction(channelId = 'thread-123') {
  return {
    channelId,
    channel: { send: jest.fn().mockResolvedValue() },
    guild: {},
    user: { id: '999' },
    options: {},
    reply: jest.fn().mockResolvedValue(),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/finish execute', () => {
  test('replies with error when not in a book thread', async () => {
    db.readingLog.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('book threads') })
    );
    expect(db.readingLog.update).not.toHaveBeenCalled();
  });

  test('replies with error when book is already finished', async () => {
    db.readingLog.findUnique.mockResolvedValue({ ...LOG, status: 'finished' });
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already marked as finished') })
    );
    expect(db.readingLog.update).not.toHaveBeenCalled();
  });

  test('updates status to finished with progress 100', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);

    expect(db.readingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'finished', finishedAt: expect.any(Date), progress: 100 }),
      })
    );
  });

  test('posts completion embed in thread', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  test('sends ephemeral confirmation mentioning book title', async () => {
    db.readingLog.findUnique.mockResolvedValue(LOG);
    db.readingLog.update.mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining('The Great Gatsby'),
      })
    );
  });

  test('works when log has no rating', async () => {
    db.readingLog.findUnique.mockResolvedValue({ ...LOG, rating: null });
    db.readingLog.update.mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);

    expect(db.readingLog.update).toHaveBeenCalled();
    expect(interaction.channel.send).toHaveBeenCalled();
  });

  test('works when book has no image', async () => {
    db.readingLog.findUnique.mockResolvedValue({ ...LOG, book: { ...BOOK, image: null } });
    db.readingLog.update.mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.channel.send).toHaveBeenCalled();
  });
});
