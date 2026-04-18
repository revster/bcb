// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockGet = jest.fn();
const mockAll = jest.fn();
const mockRun = jest.fn().mockReturnValue({ changes: 1 });

jest.mock('../../db', () => {
  const chain: any = {
    from:               jest.fn().mockReturnThis(),
    where:              jest.fn().mockReturnThis(),
    innerJoin:          jest.fn().mockReturnThis(),
    values:             jest.fn().mockReturnThis(),
    set:                jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    returning:          jest.fn().mockReturnThis(),
    get:                mockGet,
    all:                mockAll,
    run:                mockRun,
  };
  return {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    query: {},
  };
});
import scrapeBook from '../../lib/scrapeBook';
jest.mock('../../lib/scrapeBook');
jest.mock('../../lib/progressPost', () => ({ updateProgressPost: jest.fn() }));
jest.mock('../../lib/botLog', () => ({ botLog: jest.fn() }));

const db = require('../../db');
const { botLog } = require('../../lib/botLog');
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
const CLUB_BOOK = { id: 1, bookId: BOOK.id, epilogueThreadId: null, month: null, year: null };
const MEMBER_A = { userId: '111', username: 'alice', channelId: 'ch-alice' };
const MEMBER_B = { userId: '222', username: 'bob', channelId: 'ch-bob' };
const THREAD = { id: 'thread-new', url: 'https://discord.com/thread-new' };

function makeForumChannel(tagNames: string[] = []) {
  return {
    availableTags: tagNames.map((name, i) => ({ id: `tag-${i}`, name })),
    threads: { create: jest.fn().mockResolvedValue(THREAD) },
  };
}

function makeInteraction(url = VALID_URL, forumChannel = makeForumChannel(), { month = null as number | null, year = null as number | null } = {}) {
  return {
    options: {
      getString: jest.fn().mockReturnValue(url),
      getInteger: jest.fn().mockImplementation((name: string) =>
        name === 'month' ? month : name === 'year' ? year : null
      ),
    },
    user: { id: 'admin-123', username: 'admin' },
    guild: {
      channels: {
        // fetch(id) → member forum channel; fetch() → all channels (epilogue lookup, returns none)
        fetch: jest.fn().mockImplementation((id?: string) =>
          id ? Promise.resolve(forumChannel) : Promise.resolve({ find: () => null })
        ),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockAll.mockReturnValue([]);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => { mockGet.mockReset(); mockAll.mockReset(); mockRun.mockReset(); jest.clearAllMocks(); });

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
      // db.select().from(books).get() → BOOK
      // db.insert(clubBooks).returning().get() → CLUB_BOOK
      mockGet
        .mockReturnValueOnce(BOOK)      // books lookup
        .mockReturnValueOnce(CLUB_BOOK); // clubBook insert returning
      mockAll.mockReturnValueOnce([MEMBER_A, MEMBER_B]); // memberChannels
    });

    test('does not scrape when book already exists', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(scrapeBook).not.toHaveBeenCalled();
    });

    test('upserts ClubBook record', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.insert).toHaveBeenCalled();
    });

    test('creates threads for all members', async () => {
      const forum = makeForumChannel();
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledTimes(2);
    });

    test('inserts a ReadingLog for each member', async () => {
      const interaction = makeInteraction();
      await execute(interaction);

      // db.insert called: once for clubBook, twice for readingLogs (MEMBER_A, MEMBER_B)
      expect(db.insert).toHaveBeenCalledTimes(3);
    });

    test('applies matching tags when they exist on the channel', async () => {
      mockGet
        .mockReturnValueOnce(BOOK)
        .mockReturnValueOnce(CLUB_BOOK);
      mockAll.mockReturnValueOnce([MEMBER_A]);
      const forum = makeForumChannel(['Bot', 'Book of the Month', 'Other']);
      const interaction = makeInteraction(VALID_URL, forum, { month: 1, year: 2025 });
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({ appliedTags: ['tag-0', 'tag-1'] })
      );
    });

    test('creates thread with empty appliedTags when no matching tags exist', async () => {
      mockGet
        .mockReturnValueOnce(BOOK)
        .mockReturnValueOnce(CLUB_BOOK);
      mockAll.mockReturnValueOnce([MEMBER_A]);
      const forum = makeForumChannel(['Unrelated']);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      const callArg = forum.threads.create.mock.calls[0][0];
      expect(callArg.appliedTags).toEqual([]);
    });

    test('applies only the tags that exist (partial match)', async () => {
      mockGet
        .mockReturnValueOnce(BOOK)
        .mockReturnValueOnce(CLUB_BOOK);
      mockAll.mockReturnValueOnce([MEMBER_A]);
      const forum = makeForumChannel(['Bot']); // only Bot exists
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
  });

  describe('missing tag warnings', () => {
    function setupOneMember() {
      mockGet
        .mockReturnValueOnce(BOOK)
        .mockReturnValueOnce(CLUB_BOOK);
      mockAll.mockReturnValueOnce([MEMBER_A]);
    }

    test('logs warning when Bot tag is missing', async () => {
      setupOneMember();
      const forum = makeForumChannel(['Book of the Month']); // Bot missing
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Bot')
      );
    });

    test('logs warning when Book of the Month tag is missing', async () => {
      setupOneMember();
      const forum = makeForumChannel(['Bot']); // Book of the Month missing
      const interaction = makeInteraction(VALID_URL, forum, { month: 1, year: 2025 });
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Book of the Month')
      );
    });

    test('lists all missing tags when both are absent', async () => {
      setupOneMember();
      const forum = makeForumChannel([]); // both missing
      const interaction = makeInteraction(VALID_URL, forum, { month: 1, year: 2025 });
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/Bot.*Book of the Month|Book of the Month.*Bot/)
      );
    });

    test('mentions the admin user in the warning', async () => {
      setupOneMember();
      const forum = makeForumChannel([]);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('<@admin-123>')
      );
    });

    test('still creates the thread when tags are missing', async () => {
      setupOneMember();
      const forum = makeForumChannel([]);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      expect(forum.threads.create).toHaveBeenCalledTimes(1);
    });

    test('does not log a warning when all required tags are present', async () => {
      setupOneMember();
      const forum = makeForumChannel(['Bot', 'Book of the Month']);
      const interaction = makeInteraction(VALID_URL, forum);
      await execute(interaction);

      // botLog may be called for the final success log, but never for missing tags
      const missingTagCalls = (botLog as jest.Mock).mock.calls.filter(
        ([, msg]: [unknown, string]) => msg.includes('missing tags')
      );
      expect(missingTagCalls).toHaveLength(0);
    });
  });

  describe('auto-DNR previous BOTM', () => {
    const PREV_CB = { bookId: 99, month: 1, year: 2025, title: 'Prev Book' };

    function setupWithMonthYear(members = [MEMBER_A, MEMBER_B]) {
      mockGet
        .mockReturnValueOnce(BOOK)
        .mockReturnValueOnce(CLUB_BOOK);
      mockAll.mockReturnValueOnce(members); // memberChannels (mockAll #1)
    }

    test('skipped when no month/year provided', async () => {
      setupWithMonthYear();
      const interaction = makeInteraction(VALID_URL, makeForumChannel());
      await execute(interaction);

      // mockAll #2 (prev club books) never called — db.select chain only called once
      expect(botLog).not.toHaveBeenCalledWith(
        expect.anything(), expect.stringContaining('Auto-DNR')
      );
    });

    test('skipped when no previous BOTM exists', async () => {
      setupWithMonthYear();
      mockAll.mockReturnValueOnce([]); // prev club books → none
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(botLog).not.toHaveBeenCalledWith(
        expect.anything(), expect.stringContaining('Auto-DNR')
      );
    });

    test('skipped when all previous BOTM logs have progress > 0', async () => {
      setupWithMonthYear();
      mockAll
        .mockReturnValueOnce([PREV_CB])  // prev club books
        .mockReturnValueOnce([]);        // no untouched logs
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(db.update).not.toHaveBeenCalled();
      expect(botLog).not.toHaveBeenCalledWith(
        expect.anything(), expect.stringContaining('Auto-DNR')
      );
    });

    test('updates untouched reading logs to dnr', async () => {
      setupWithMonthYear([MEMBER_A, MEMBER_B]);
      mockAll
        .mockReturnValueOnce([PREV_CB])              // prev club books
        .mockReturnValueOnce([{ userId: MEMBER_A.userId }]); // one untouched log
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(db.update).toHaveBeenCalled();
    });

    test('logs auto-DNR to bot-log with book title, month/year, and usernames', async () => {
      setupWithMonthYear([MEMBER_A, MEMBER_B]);
      mockAll
        .mockReturnValueOnce([PREV_CB])
        .mockReturnValueOnce([{ userId: MEMBER_A.userId }, { userId: MEMBER_B.userId }]);
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/Auto-DNR.*Prev Book.*January 2025.*alice.*bob|Auto-DNR.*Prev Book.*January 2025.*bob.*alice/)
      );
    });

    test('picks the most recent previous BOTM when multiple exist', async () => {
      setupWithMonthYear([MEMBER_A]);
      // Two prev club books: Feb 2025 is more recent than Jan 2025
      mockAll
        .mockReturnValueOnce([
          { bookId: 88, month: 1, year: 2025, title: 'Jan Book' },
          { bookId: 99, month: 2, year: 2025, title: 'Feb Book' },
        ])
        .mockReturnValueOnce([{ userId: MEMBER_A.userId }]);
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(botLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Feb Book')
      );
      expect(botLog).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Jan Book')
      );
    });

    test('does not DNR books from a future month', async () => {
      setupWithMonthYear([MEMBER_A]);
      // April 2025 is AFTER the current March 2025 — should not be considered previous
      mockAll
        .mockReturnValueOnce([{ bookId: 77, month: 4, year: 2025, title: 'April Book' }])
        .mockReturnValueOnce([]);
      const interaction = makeInteraction(VALID_URL, makeForumChannel(), { month: 3, year: 2025 });
      await execute(interaction);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('when book does not exist in DB', () => {
    beforeEach(() => {
      // db.select().from(books).get() → undefined (not found)
      // db.insert(books).returning().get() → BOOK
      // db.insert(clubBooks).returning().get() → CLUB_BOOK
      mockGet
        .mockReturnValueOnce(undefined) // books lookup → not found
        .mockReturnValueOnce(BOOK)      // books insert returning
        .mockReturnValueOnce(CLUB_BOOK); // clubBook insert returning
      mockAll.mockReturnValueOnce([]);  // no members
      jest.mocked(scrapeBook).mockResolvedValue({
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
    });

    test('replies with error when scrape fails', async () => {
      jest.mocked(scrapeBook).mockRejectedValue(new Error('404'));
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch book info')
      );
    });
  });
});
