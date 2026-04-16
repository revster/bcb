jest.mock('../../db', () => ({
  readingLog: { findMany: jest.fn() },
  clubBook: { findMany: jest.fn() },
}));

const db = require('../../db');
const { execute } = require('../../commands/stats');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOOK_A = { pages: 200, genres: '["Fiction","Classics"]' };
const BOOK_B = { pages: 300, genres: '["Science Fiction"]' };
const BOOK_C = { pages: 150, genres: '["Fiction"]' };
const BOOK_NO_PAGES = { pages: null, genres: '[]' };

function makeLog(bookId, status, { rating = null, book = BOOK_A } = {}) {
  return { bookId, status, rating, book };
}

function makeInteraction({ targetUser = null } = {}) {
  return {
    user: { id: '111', username: 'alice', displayName: 'alice' },
    options: { getUser: jest.fn().mockReturnValue(targetUser) },
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

function getEmbed(interaction) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

function getField(embed, name) {
  return embed.data.fields.find(f => f.name === name);
}

afterEach(() => jest.resetAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/stats execute', () => {
  describe('no data', () => {
    test('replies with no-history message when user has no logs', async () => {
      db.readingLog.findMany.mockResolvedValue([]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('No reading history') })
      );
    });
  });

  describe('user routing', () => {
    beforeEach(() => {
      db.readingLog.findMany.mockResolvedValue([makeLog(1, 'finished')]);
      db.clubBook.findMany.mockResolvedValue([]);
    });

    test('queries by interaction.user.id when no target provided', async () => {
      await execute(makeInteraction());
      expect(db.readingLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: '111' }) })
      );
    });

    test('queries by target user id when user option provided', async () => {
      const targetUser = { id: '999', username: 'bob', displayName: 'bob' };
      await execute(makeInteraction({ targetUser }));
      expect(db.readingLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: '999' }) })
      );
    });

    test('embed title uses target display name', async () => {
      const targetUser = { id: '999', username: 'bob', displayName: 'bob' };
      const interaction = makeInteraction({ targetUser });
      await execute(interaction);
      const embed = getEmbed(interaction);
      expect(embed.data.title).toContain('bob');
    });
  });

  describe('All Reads counts', () => {
    test('counts finished, reading, and abandoned correctly', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'reading'),
        makeLog(3, 'abandoned'),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **1**');
      expect(field.value).toContain('Reading:  **1**');
      expect(field.value).toContain('Abandoned: **1**');
    });

    test('counts multiple finished books correctly', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'finished'),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **3**');
    });
  });

  describe('deduplication', () => {
    test('two logs for same book (finished + reading) count as 1 finished, 0 reading', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'), // re-run club-start created a new thread for same book
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **1**');
      expect(field.value).toContain('Reading:  **0**');
    });

    test('two logs for same book (abandoned + reading) count as 1 reading, 0 abandoned', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'reading'),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Reading:  **1**');
      expect(field.value).toContain('Abandoned: **0**');
    });

    test('two abandoned logs for same book count as 1 abandoned', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'abandoned'),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Abandoned: **1**');
    });
  });

  describe('total pages', () => {
    test('sums pages from finished books only', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 200, genres: '[]' } }),
        makeLog(2, 'finished', { book: { pages: 300, genres: '[]' } }),
        makeLog(3, 'reading',  { book: { pages: 999, genres: '[]' } }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Total Pages Read');
      expect(field.value).toBe('500');
    });

    test('omits total pages field when no finished books have known page counts', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { book: BOOK_NO_PAGES }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Total Pages Read')).toBeUndefined();
    });

    test('does not double-count pages when same book has two logs', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 300, genres: '[]' } }),
        makeLog(1, 'reading',  { book: { pages: 300, genres: '[]' } }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Total Pages Read');
      expect(field.value).toBe('300');
    });
  });

  describe('average rating', () => {
    test('calculates average rating across rated logs', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { rating: 4 }),
        makeLog(2, 'finished', { rating: 3 }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Avg Rating');
      expect(field.value).toContain('3.50');
    });

    test('omits avg rating field when no logs have ratings', async () => {
      db.readingLog.findMany.mockResolvedValue([makeLog(1, 'finished')]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Avg Rating')).toBeUndefined();
    });
  });

  describe('favourite genre', () => {
    test('returns most common genre across finished books', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 100, genres: '["Fiction","Classics"]' } }),
        makeLog(2, 'finished', { book: { pages: 100, genres: '["Fiction","Mystery"]' } }),
        makeLog(3, 'finished', { book: { pages: 100, genres: '["Classics"]' } }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });

    test('omits favourite genre when finished books have no genre data', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { book: BOOK_NO_PAGES }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Favourite Genre')).toBeUndefined();
    });

    test('only counts genres from finished books, not reading or abandoned', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished',  { book: { pages: 100, genres: '["Fiction"]' } }),
        makeLog(2, 'reading',   { book: { pages: 100, genres: '["Horror","Horror","Horror"]' } }),
        makeLog(3, 'abandoned', { book: { pages: 100, genres: '["Horror","Horror"]' } }),
      ]);
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });
  });

  describe('Book of the Month section', () => {
    test('omits Book of the Month section when user has no club logs', async () => {
      db.readingLog.findMany.mockResolvedValue([makeLog(1, 'finished')]);
      db.clubBook.findMany.mockResolvedValue([]); // no club books → bookId 1 is not a club book
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '── Book of the Month ──')).toBeUndefined();
    });

    test('shows Book of the Month section when user has club logs', async () => {
      db.readingLog.findMany.mockResolvedValue([makeLog(1, 'finished')]);
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '── Book of the Month ──')).toBeDefined();
    });

    test('shows correct finished count and completion rate', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'abandoned'),
      ]);
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('Finished: **2**');
      expect(field.value).toContain('2/3');
      expect(field.value).toContain('67%');
    });

    test('shows correct abandoned count', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'abandoned'),
      ]);
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('Abandoned: **1**');
    });

    test('deduplicates club books correctly (finished + reading → 1 finished)', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'), // re-run
      ]);
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('1/1');
      expect(field.value).toContain('100%');
    });

    test('shows club avg rating when club logs are rated', async () => {
      db.readingLog.findMany.mockResolvedValue([
        makeLog(1, 'finished', { rating: 5 }),
        makeLog(2, 'finished', { rating: 3 }),
      ]);
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const fields = getEmbed(interaction).data.fields;
      const ratingFields = fields.filter(f => f.name === 'Avg Rating');
      // One for all reads, one for club reads
      expect(ratingFields.length).toBe(2);
    });
  });
});
