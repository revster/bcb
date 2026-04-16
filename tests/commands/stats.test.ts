// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockFindMany = jest.fn();
const mockAll = jest.fn();

jest.mock('../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    all:     mockAll,
  };
  return {
    select: jest.fn(() => chain),
    query: {
      readingLogs: { findMany: mockFindMany },
    },
  };
});

const { execute } = require('../../commands/stats');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOOK_A = { pages: 200, genres: '["Fiction","Classics"]' };
const BOOK_B = { pages: 300, genres: '["Science Fiction"]' };
const BOOK_C = { pages: 150, genres: '["Fiction"]' };
const BOOK_NO_PAGES = { pages: null, genres: '[]' };

function makeLog(bookId: number, status: string, { rating = null as number | null, book = BOOK_A as { pages: number | null; genres: string } } = {}) {
  return { bookId, status, rating, book };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInteraction({ targetUser = null as any } = {}) {
  return {
    user: { id: '111', username: 'alice', displayName: 'alice' },
    options: { getUser: jest.fn().mockReturnValue(targetUser) },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEmbed(interaction: any) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getField(embed: any, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return embed.data.fields.find((f: any) => f.name === name);
}

beforeEach(() => {
  mockAll.mockReturnValue([]);
});
afterEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/stats execute', () => {
  describe('no data', () => {
    test('replies with no-history message when user has no logs', async () => {
      mockFindMany.mockResolvedValue([]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('No reading history') })
      );
    });
  });

  describe('user routing', () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([]);
    });

    test('embed title uses the caller display name by default', async () => {
      const interaction = makeInteraction();
      await execute(interaction);
      const embed = getEmbed(interaction);
      expect(embed.data.title).toContain('alice');
    });

    test('embed title uses target display name when user option provided', async () => {
      const targetUser = { id: '999', username: 'bob', displayName: 'bob' };
      const interaction = makeInteraction({ targetUser });
      await execute(interaction);
      const embed = getEmbed(interaction);
      expect(embed.data.title).toContain('bob');
    });
  });

  describe('All Reads counts', () => {
    test('counts finished, reading, and abandoned correctly', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'reading'),
        makeLog(3, 'abandoned'),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **1**');
      expect(field.value).toContain('Reading:  **1**');
      expect(field.value).toContain('Abandoned: **1**');
    });

    test('counts multiple finished books correctly', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'finished'),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **3**');
    });
  });

  describe('deduplication', () => {
    test('two logs for same book (finished + reading) count as 1 finished, 0 reading', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Finished: **1**');
      expect(field.value).toContain('Reading:  **0**');
    });

    test('two logs for same book (abandoned + reading) count as 1 reading, 0 abandoned', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'reading'),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Reading:  **1**');
      expect(field.value).toContain('Abandoned: **0**');
    });

    test('two abandoned logs for same book count as 1 abandoned', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'abandoned'),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── All Reads ──');
      expect(field.value).toContain('Abandoned: **1**');
    });
  });

  describe('total pages', () => {
    test('sums pages from finished books only', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 200, genres: '[]' } }),
        makeLog(2, 'finished', { book: { pages: 300, genres: '[]' } }),
        makeLog(3, 'reading',  { book: { pages: 999, genres: '[]' } }),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Total Pages Read');
      expect(field.value).toBe('500');
    });

    test('omits total pages field when no finished books have known page counts', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NO_PAGES })]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Total Pages Read')).toBeUndefined();
    });

    test('does not double-count pages when same book has two logs', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 300, genres: '[]' } }),
        makeLog(1, 'reading',  { book: { pages: 300, genres: '[]' } }),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Total Pages Read');
      expect(field.value).toBe('300');
    });
  });

  describe('average rating', () => {
    test('calculates average rating across rated logs', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { rating: 4 }),
        makeLog(2, 'finished', { rating: 3 }),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Avg Rating');
      expect(field.value).toContain('3.50');
    });

    test('omits avg rating field when no logs have ratings', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Avg Rating')).toBeUndefined();
    });
  });

  describe('favourite genre', () => {
    test('returns most common genre across finished books', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 100, genres: '["Fiction","Classics"]' } }),
        makeLog(2, 'finished', { book: { pages: 100, genres: '["Fiction","Mystery"]' } }),
        makeLog(3, 'finished', { book: { pages: 100, genres: '["Classics"]' } }),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });

    test('omits favourite genre when finished books have no genre data', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NO_PAGES })]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Favourite Genre')).toBeUndefined();
    });

    test('only counts genres from finished books, not reading or abandoned', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished',  { book: { pages: 100, genres: '["Fiction"]' } }),
        makeLog(2, 'reading',   { book: { pages: 100, genres: '["Horror","Horror","Horror"]' } }),
        makeLog(3, 'abandoned', { book: { pages: 100, genres: '["Horror","Horror"]' } }),
      ]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });
  });

  describe('Book of the Month section', () => {
    test('omits Book of the Month section when user has no club logs', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([]); // no club books
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '── Book of the Month ──')).toBeUndefined();
    });

    test('shows Book of the Month section when user has club logs', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([{ bookId: 1 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '── Book of the Month ──')).toBeDefined();
    });

    test('shows correct finished count and completion rate', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'abandoned'),
      ]);
      mockAll.mockReturnValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('Finished: **2**');
      expect(field.value).toContain('2/3');
      expect(field.value).toContain('67%');
    });

    test('shows correct abandoned count', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'abandoned'),
      ]);
      mockAll.mockReturnValue([{ bookId: 1 }, { bookId: 2 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('Abandoned: **1**');
    });

    test('deduplicates club books correctly (finished + reading → 1 finished)', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'),
      ]);
      mockAll.mockReturnValue([{ bookId: 1 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '── Book of the Month ──');
      expect(field.value).toContain('1/1');
      expect(field.value).toContain('100%');
    });

    test('shows club avg rating when club logs are rated', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { rating: 5 }),
        makeLog(2, 'finished', { rating: 3 }),
      ]);
      mockAll.mockReturnValue([{ bookId: 1 }, { bookId: 2 }]);
      const interaction = makeInteraction();
      await execute(interaction);

      const fields = getEmbed(interaction).data.fields;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ratingFields = fields.filter((f: any) => f.name === 'Avg Rating');
      // One for all reads, one for club reads
      expect(ratingFields.length).toBe(2);
    });
  });
});
