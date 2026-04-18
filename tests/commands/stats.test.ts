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

const CURRENT_YEAR = new Date().getFullYear();
const THIS_YEAR    = new Date();           // startedAt in current year
const OLD_DATE     = new Date('2020-01-01'); // startedAt in the past, never current year

const BOOK_A        = { id: 10, title: 'Book A',       pages: 200,  genres: '["Fiction","Classics"]' };
const BOOK_B        = { id: 11, title: 'Book B',       pages: 300,  genres: '["Science Fiction"]' };
const BOOK_C        = { id: 12, title: 'Book C',       pages: 150,  genres: '["Fiction"]' };
const BOOK_LONG     = { id: 13, title: 'Longest Book', pages: 900,  genres: '[]' };
const BOOK_NO_PAGES = { id: 14, title: 'No Pages',     pages: null, genres: '[]' };

function makeLog(bookId: number, status: string, {
  rating    = null as number | null,
  book      = BOOK_A as { title?: string; pages: number | null; genres: string },
  startedAt = OLD_DATE,
  progress  = 0,
} = {}) {
  return { bookId, status, rating, book: { title: 'Untitled', ...book }, startedAt, progress };
}

/** Club book fixture with optional month/year for streak tests. */
function makeClubBook(bookId: number, { month = null as number | null, year = null as number | null } = {}) {
  return { bookId, month, year };
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
afterEach(() => { mockAll.mockReset(); jest.clearAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/stats execute', () => {
  describe('no data', () => {
    test('replies with no-history message when user has no logs', async () => {
      mockFindMany.mockResolvedValue([]);
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
    });

    test('embed title uses the caller display name by default', async () => {
      const interaction = makeInteraction();
      await execute(interaction);
      expect(getEmbed(interaction).data.title).toContain('alice');
    });

    test('embed title uses target display name when user option provided', async () => {
      const targetUser = { id: '999', username: 'bob', displayName: 'bob' };
      const interaction = makeInteraction({ targetUser });
      await execute(interaction);
      expect(getEmbed(interaction).data.title).toContain('bob');
    });
  });

  describe('All Time counts', () => {
    test('counts finished, reading, and abandoned correctly', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'reading'),
        makeLog(3, 'abandoned'),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
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
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
      expect(field.value).toContain('Finished: **3**');
    });
  });

  describe('deduplication', () => {
    test('two logs for same book (finished + reading) count as 1 finished, 0 reading', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
      expect(field.value).toContain('Finished: **1**');
      expect(field.value).toContain('Reading:  **0**');
    });

    test('two logs for same book (abandoned + reading) count as 1 reading, 0 abandoned', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'reading'),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
      expect(field.value).toContain('Reading:  **1**');
      expect(field.value).toContain('Abandoned: **0**');
    });

    test('two abandoned logs for same book count as 1 abandoned', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'abandoned'),
        makeLog(1, 'abandoned'),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
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
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Total Pages Read');
      expect(field.value).toBe('500');
    });

    test('omits total pages field when no finished books have known page counts', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NO_PAGES })]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Total Pages Read')).toBeUndefined();
    });

    test('does not double-count pages when same book has two logs', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { book: { pages: 300, genres: '[]' } }),
        makeLog(1, 'reading',  { book: { pages: 300, genres: '[]' } }),
      ]);
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
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Avg Rating');
      expect(field.value).toContain('3.50');
    });

    test('omits avg rating field when no logs have ratings', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
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
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });

    test('omits favourite genre when finished books have no genre data', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NO_PAGES })]);
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
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Favourite Genre');
      expect(field.value).toBe('Fiction');
    });
  });

  describe('longest finished book', () => {
    test('shows the book with the most pages', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { book: BOOK_A }),
        makeLog(2, 'finished', { book: BOOK_LONG }),
        makeLog(3, 'finished', { book: BOOK_B }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Longest Finished');
      expect(field.value).toContain('Longest Book');
      expect(field.value).toContain('900');
    });

    test('omits field when no finished books have page counts', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished', { book: BOOK_NO_PAGES })]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), 'Longest Finished')).toBeUndefined();
    });

    test('does not count reading books for longest', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'reading',  { book: BOOK_LONG }),
        makeLog(2, 'finished', { book: BOOK_A }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), 'Longest Finished');
      expect(field.value).toContain('Book A');
      expect(field.value).not.toContain('Longest Book');
    });
  });

  describe('Currently Reading bars', () => {
    test('shows currently reading section when books are in progress', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'reading', { book: BOOK_A, progress: 50 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📖 Currently Reading');
      expect(field).toBeDefined();
      expect(field.value).toContain('Book A');
    });

    test('omits currently reading section when nothing is in progress', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '📖 Currently Reading')).toBeUndefined();
    });

    test('shows progress percentage in bar', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'reading', { book: BOOK_A, progress: 75 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📖 Currently Reading');
      expect(field.value).toContain('75%');
    });

    test('shows all currently reading books', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'reading', { book: BOOK_A, progress: 30 }),
        makeLog(2, 'reading', { book: BOOK_B, progress: 60 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📖 Currently Reading');
      expect(field.value).toContain('Book A');
      expect(field.value).toContain('Book B');
    });
  });

  describe('This Year section', () => {
    test('shows This Year field when user has logs started this year', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { startedAt: THIS_YEAR }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '📅 This Year')).toBeDefined();
    });

    test('omits This Year field when all logs are from previous years', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { startedAt: OLD_DATE }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '📅 This Year')).toBeUndefined();
    });

    test('counts only this-year logs in the This Year field', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { startedAt: THIS_YEAR }),
        makeLog(2, 'finished', { startedAt: THIS_YEAR }),
        makeLog(3, 'finished', { startedAt: OLD_DATE }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📅 This Year');
      expect(field.value).toContain('Finished: **2**');
    });

    test('All Time field still shows all-time totals alongside This Year', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { startedAt: THIS_YEAR }),
        makeLog(2, 'finished', { startedAt: OLD_DATE }),
        makeLog(3, 'finished', { startedAt: OLD_DATE }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '📚 All Time');
      expect(field.value).toContain('Finished: **3**');
    });
  });

  describe('Book of the Month — All Time section', () => {
    test('omits BOTM sections when user has no club logs', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '🏆 Book of the Month — All Time')).toBeUndefined();
    });

    test('shows BOTM All Time section when user has club logs', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '🏆 Book of the Month — All Time')).toBeDefined();
    });

    test('shows correct finished count and completion rate', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'abandoned'),
      ]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 }), makeClubBook(2, { month: 2, year: 2025 }), makeClubBook(3, { month: 3, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Finished: **2**');
      expect(field.value).toContain('2/3');
      expect(field.value).toContain('67%');
    });

    test('shows correct abandoned count', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'abandoned'),
      ]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 }), makeClubBook(2, { month: 2, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Abandoned: **1**');
    });

    test('deduplicates club books correctly (finished + reading → 1 finished)', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(1, 'reading'),
      ]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('1/1');
      expect(field.value).toContain('100%');
    });

    test('shows club avg rating in BOTM All Time section', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished', { rating: 5 }),
        makeLog(2, 'finished', { rating: 3 }),
      ]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 }), makeClubBook(2, { month: 2, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('4.00');
    });
  });

  describe('Book of the Month — This Year section', () => {
    test('shows BOTM This Year section when user has club logs for this year', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: CURRENT_YEAR })]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '🏆 Book of the Month — This Year')).toBeDefined();
    });

    test('omits BOTM This Year when club books have no year set', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1)]); // no year
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '🏆 Book of the Month — This Year')).toBeUndefined();
    });

    test('omits BOTM This Year when club books are from a previous year', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2020 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getField(getEmbed(interaction), '🏆 Book of the Month — This Year')).toBeUndefined();
    });

    test('shows correct finished count for this year only', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'abandoned'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: CURRENT_YEAR }),
        makeClubBook(2, { month: 2, year: CURRENT_YEAR }),
        makeClubBook(3, { month: 3, year: CURRENT_YEAR }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — This Year');
      expect(field.value).toContain('Finished: **2**');
      expect(field.value).toContain('2/3');
    });

    test('past year books appear in All Time but not This Year', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),  // past year book
        makeLog(2, 'finished'),  // this year book
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2020 }),
        makeClubBook(2, { month: 1, year: CURRENT_YEAR }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const thisYear = getField(getEmbed(interaction), '🏆 Book of the Month — This Year');
      const allTime  = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(thisYear.value).toContain('1/1');   // only this year's book
      expect(allTime.value).toContain('2/2');    // both books
    });
  });

  describe('completion streak', () => {
    test('shows streak of 1 for a single finished BOTM', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Longest streak: **1**');
    });

    test('counts consecutive finishes correctly', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'finished'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 3, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Longest streak: **3**');
    });

    test('resets streak on unfinished month', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'abandoned'), // breaks streak
        makeLog(3, 'finished'),
        makeLog(4, 'finished'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 3, year: 2025 }),
        makeClubBook(4, { month: 4, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      // Best run is months 3+4 = 2, not 4
      expect(field.value).toContain('Longest streak: **2**');
    });

    test('joining late does not penalise — streak starts from first enrollment', async () => {
      mockFindMany.mockResolvedValue([
        // no log for month 1 (not enrolled yet)
        makeLog(2, 'finished'),
        makeLog(3, 'finished'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 3, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Longest streak: **2**');
    });

    test('in-progress last month does not break streak', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
        makeLog(3, 'reading'), // current month, still in progress
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 3, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('Longest streak: **2**');
    });

    test('omits streak line when streak is zero', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'abandoned')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).not.toContain('streak');
    });

    test('omits streak line when user never completed a BOTM (streak is 0)', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'abandoned')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).not.toContain('streak');
    });

    test('singular "month" for streak of 1', async () => {
      mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
      mockAll.mockReturnValue([makeClubBook(1, { month: 1, year: 2025 })]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('1** month');
      expect(field.value).not.toContain('1** months');
    });

    test('two books in same month: finishing one is enough to keep streak', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'abandoned'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 1, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('streak');
      expect(field.value).toContain('1** month');
    });

    test('two books in same month: finishing both still counts as 1 month', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'finished'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 1, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      expect(field.value).toContain('1** month');
    });

    test('two books in same month: finishing neither resets streak', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),  // Jan 2025
        makeLog(2, 'abandoned'), // Feb 2025 — book A
        makeLog(3, 'abandoned'), // Feb 2025 — book B
        makeLog(4, 'finished'),  // Mar 2025
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 2, year: 2025 }),
        makeClubBook(4, { month: 3, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      // Best streak is 1 (Jan or Mar individually, Feb broke it)
      expect(field.value).toContain('1** month');
    });

    test('two books in same month: reading one in last month does not break streak', async () => {
      mockFindMany.mockResolvedValue([
        makeLog(1, 'finished'),
        makeLog(2, 'reading'),
        makeLog(3, 'abandoned'),
      ]);
      mockAll.mockReturnValue([
        makeClubBook(1, { month: 1, year: 2025 }),
        makeClubBook(2, { month: 2, year: 2025 }),
        makeClubBook(3, { month: 2, year: 2025 }),
      ]);
      const interaction = makeInteraction();
      await execute(interaction);

      const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
      // Jan finished (streak=1), Feb has one reading so don't break
      expect(field.value).toContain('streak');
    });
  });
});

// ── Non-BOTM club reads ───────────────────────────────────────────────────────

describe('non-BOTM club reads (no month/year)', () => {
  test('club read without month and year does not show BOTM section', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1)]); // month: null, year: null
    const interaction = makeInteraction();
    await execute(interaction);

    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields.map((f: any) => f.name);
    expect(fieldNames).not.toContain('🏆 Book of the Month — All Time');
    expect(fieldNames).not.toContain('🏆 Book of the Month — This Year');
  });

  test('club read with only month set (no year) does not show BOTM section', async () => {
    mockFindMany.mockResolvedValue([makeLog(1, 'finished')]);
    mockAll.mockReturnValue([makeClubBook(1, { month: 3, year: null })]);
    const interaction = makeInteraction();
    await execute(interaction);

    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields.map((f: any) => f.name);
    expect(fieldNames).not.toContain('🏆 Book of the Month — All Time');
  });

  test('only official BOTM books (with month+year) count in BOTM section', async () => {
    // bookId 1 = official BOTM, bookId 2 = club read without month/year
    mockFindMany.mockResolvedValue([
      makeLog(1, 'finished', { book: BOOK_A }),
      makeLog(2, 'finished', { book: BOOK_B }),
    ]);
    mockAll.mockReturnValue([
      makeClubBook(1, { month: 1, year: 2025 }),
      makeClubBook(2), // no month/year — not BOTM
    ]);
    const interaction = makeInteraction();
    await execute(interaction);

    const field = getField(getEmbed(interaction), '🏆 Book of the Month — All Time');
    // Only book 1 counts: 1 finished out of 1 enrolled
    expect(field.value).toContain('1/1');
  });
});
