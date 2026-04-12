jest.mock('../../db', () => ({
  book: { findUnique: jest.fn(), upsert: jest.fn() },
  clubBook: { upsert: jest.fn() },
  memberChannel: { findMany: jest.fn() },
  readingLog: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock('../../lib/scrapeBook');
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));

const db = require('../../db');
const scrapeBook = require('../../lib/scrapeBook');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/club-start');

const VALID_URL = 'https://www.goodreads.com/book/show/4671.The_Great_Gatsby';
const BOOK = {
  id: 42,
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  goodreadsUrl: VALID_URL,
  image: null,
  rating: '3.93 / 5',
  pages: 180,
  genres: '["Fiction"]',
};
const MEMBER_A = { userId: '111', username: 'alice', channelId: 'ch-alice' };
const MEMBER_B = { userId: '222', username: 'bob', channelId: 'ch-bob' };
const THREAD = { id: 'thread-new', url: 'https://discord.com/thread-new' };

function makeForumChannel(tagNames = []) {
  return {
    availableTags: tagNames.map((name, i) => ({ id: `tag-${i}`, name })),
    threads: { create: jest.fn().mockResolvedValue(THREAD) },
  };
}

function makeInteraction(url = VALID_URL, forumChannel = makeForumChannel()) {
  return {
    options: { getString: jest.fn().mockReturnValue(url) },
    guild: {
      channels: { fetch: jest.fn().mockResolvedValue(forumChannel) },
    },
    reply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/club-start execute', () => {
  test('rejects a non-Goodreads URL', async () => {
    const interaction = makeInteraction('https://amazon.com/book/123');
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('valid Goodreads book URL') })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  describe('when book already exists in DB', () => {
    beforeEach(() => {
      db.book.findUnique.mockResolvedValue(BOOK);
      db.clubBook.upsert.mockResolvedValue({});
      db.memberChannel.findMany.mockResolvedValue([MEMBER_A, MEMBER_B]);
      db.readingLog.findFirst.mockResolvedValue(null);
      db.readingLog.create.mockResolvedValue({});
    });

    test('does not scrape when book already exists', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(scrapeBook).not.toHaveBeenCalled();
    });

    test('upserts ClubBook record', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.clubBook.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bookId: BOOK.id } })
      );
    });

    test('creates threads for all members', async () => {
      const forum = makeForumChannel();
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledTimes(2);
    });

    test('creates a ReadingLog for each member', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.readingLog.create).toHaveBeenCalledTimes(2);
      expect(db.readingLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: '111', bookId: BOOK.id }) })
      );
    });

    test('skips members who already have a reading log', async () => {
      db.readingLog.findFirst
        .mockResolvedValueOnce({ id: 1 }) // alice already has a log
        .mockResolvedValueOnce(null);       // bob does not
      const forum = makeForumChannel();
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledTimes(1);
      expect(db.readingLog.create).toHaveBeenCalledTimes(1);
    });

    test('applies matching tags when they exist on the channel', async () => {
      const forum = makeForumChannel(['Bot', 'Book Club Book', 'Other']);
      db.memberChannel.findMany.mockResolvedValue([MEMBER_A]);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({ appliedTags: ['tag-0', 'tag-1'] })
      );
    });

    test('creates thread without appliedTags when no matching tags exist', async () => {
      const forum = makeForumChannel(['Unrelated']);
      db.memberChannel.findMany.mockResolvedValue([MEMBER_A]);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      const callArg = forum.threads.create.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('appliedTags');
    });

    test('applies only the tags that exist (partial match)', async () => {
      const forum = makeForumChannel(['Bot']); // only Bot exists, not "Book Club Book"
      db.memberChannel.findMany.mockResolvedValue([MEMBER_A]);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({ appliedTags: ['tag-0'] })
      );
    });

    test('editReply mentions created members', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('alice')
      );
    });

    test('editReply mentions skipped members', async () => {
      db.readingLog.findFirst.mockResolvedValue({ id: 1 }); // all members skipped
      const interaction = makeInteraction();
      await execute(interaction);

      const reply = interaction.editReply.mock.calls[0][0];
      expect(reply).toContain('skipped');
    });
  });

  describe('when book does not exist in DB', () => {
    beforeEach(() => {
      db.book.findUnique.mockResolvedValue(null);
      db.book.upsert.mockResolvedValue(BOOK);
      db.clubBook.upsert.mockResolvedValue({});
      db.memberChannel.findMany.mockResolvedValue([]);
      scrapeBook.mockResolvedValue({
        title: 'The Great Gatsby',
        author: 'F. Scott Fitzgerald',
        rating: '3.93 / 5',
        pages: 180,
        image: null,
        genres: ['Fiction'],
      });
    });

    test('scrapes the book when not found in DB', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(scrapeBook).toHaveBeenCalledWith(VALID_URL);
      expect(db.book.upsert).toHaveBeenCalled();
    });

    test('replies with error when scrape fails', async () => {
      scrapeBook.mockRejectedValue(new Error('404'));
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch book info')
      );
      expect(db.clubBook.upsert).not.toHaveBeenCalled();
    });
  });
});
