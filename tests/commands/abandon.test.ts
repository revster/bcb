jest.mock('../../db', () => ({
  readingLog: { findUnique: jest.fn(), update: jest.fn() },
  clubBook:   { findUnique: jest.fn() },
}));
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/abandon');

const BOOK = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', goodreadsUrl: 'https://www.goodreads.com/book/show/4671', pages: 180 };
const LOG  = { userId: '999', bookId: 1, status: 'reading', progress: 50, book: BOOK };

function makeBotChannel(extraTags: Array<{ id: string; name: string }> = []) {
  return {
    send: jest.fn().mockResolvedValue(undefined),
    setAppliedTags: jest.fn().mockResolvedValue(undefined),
    parent: { availableTags: [{ id: 'tag-bot', name: 'Bot' }, ...extraTags] },
    appliedTags: ['tag-bot'],
  };
}

function makeInteraction({ channelId = 'thread-123', channel = makeBotChannel() } = {}) {
  return {
    channelId,
    channel,
    guild: { id: 'guild-1' },
    user: { id: '999', username: 'alice' },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.resetAllMocks());

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
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('rejects when no reading log found for thread', async () => {
      db.readingLog.findUnique.mockResolvedValue(null);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('book threads') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('rejects when log belongs to a different user', async () => {
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, userId: 'other-user' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('your own') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('rejects when book is already finished', async () => {
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, status: 'finished' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as finished') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });

    test('rejects when book is already abandoned', async () => {
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, status: 'abandoned' });
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already marked as abandoned') })
      );
      expect(db.readingLog.update).not.toHaveBeenCalled();
    });
  });

  describe('successful abandon', () => {
    test('sets status to abandoned in the database', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.readingLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'abandoned' } })
      );
    });

    test('sends an embed in the thread showing progress at abandonment', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.arrayContaining([expect.anything()]) })
      );
    });

    test('replies ephemerally confirming abandonment', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
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
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, progress: 50 });
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      // 50% of 180 pages = page 90; description is set by buildBookEmbed
      const embedDescription = interaction.channel.send.mock.calls[0][0].embeds[0].data.description;
      expect(embedDescription).toContain('page 90 / 180');
    });

    test('shows percentage in embed description when book has no pages', async () => {
      const bookNoPages = { ...BOOK, pages: null };
      db.readingLog.findUnique.mockResolvedValue({ ...LOG, progress: 33, book: bookNoPages });
      db.readingLog.update.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      const embedDescription = interaction.channel.send.mock.calls[0][0].embeds[0].data.description;
      expect(embedDescription).toContain('33%');
    });
  });

  describe('Abandoned tag', () => {
    test('applies Abandoned tag when it exists on the parent channel', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const channel = makeBotChannel([{ id: 'tag-abandoned', name: 'Abandoned' }]);
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(channel.setAppliedTags).toHaveBeenCalledWith(
        expect.arrayContaining(['tag-bot', 'tag-abandoned'])
      );
    });

    test('does not call setAppliedTags when Abandoned tag is absent', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const channel = makeBotChannel(); // no Abandoned tag
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(channel.setAppliedTags).not.toHaveBeenCalled();
    });

    test('command still completes if setAppliedTags rejects', async () => {
      db.readingLog.findUnique.mockResolvedValue(LOG);
      db.readingLog.update.mockResolvedValue({});
      const channel = makeBotChannel([{ id: 'tag-abandoned', name: 'Abandoned' }]);
      channel.setAppliedTags.mockRejectedValue(new Error('Missing Permissions'));
      const interaction = makeInteraction({ channel });
      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('abandoned') })
      );
    });
  });
});
