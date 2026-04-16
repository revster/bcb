// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockFindMany = jest.fn();
const mockAll = jest.fn();

jest.mock('../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    all:     mockAll,
  };
  return {
    select: jest.fn(() => chain),
    query: {
      clubBooks: { findMany: mockFindMany },
    },
  };
});

const { execute } = require('../../commands/abandoned');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction() {
  return {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply:  jest.fn().mockResolvedValue(undefined),
  };
}

function makeClubBook(bookId: number, { title = 'Book', author = 'Author', month = null as number | null, year = null as number | null } = {}) {
  return { bookId, month, year, book: { title, author } };
}

function makeLog(userId: string, bookId: number, status: string) {
  return { userId, bookId, status };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEmbed(interaction: any) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReplyContent(interaction: any) {
  return interaction.editReply.mock.calls[0][0].content;
}

beforeEach(() => {
  mockAll.mockReturnValue([]);
});
afterEach(() => { mockFindMany.mockReset(); mockAll.mockReset(); jest.clearAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/abandoned execute', () => {
  describe('no data', () => {
    test('replies with no-data message when no club books exist', async () => {
      mockFindMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found.');
    });

    test('replies with no-abandonments message when nobody abandoned any club book', async () => {
      mockFindMany.mockResolvedValue([makeClubBook(1)]);
      mockAll.mockReturnValue([makeLog('alice', 1, 'finished')]);

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club reads have been abandoned yet.');
    });
  });

  describe('ranking', () => {
    test('shows clubs books ranked by abandonment count', async () => {
      mockFindMany.mockResolvedValue([
        makeClubBook(1, { title: 'Book A', author: 'Author' }),
        makeClubBook(2, { title: 'Book B', author: 'Author' }),
      ]);
      mockAll.mockReturnValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('bob',   1, 'abandoned'),
        makeLog('carol', 2, 'abandoned'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      // Book A (2 abandonments) should appear before Book B (1 abandonment)
      expect(desc.indexOf('Book A')).toBeLessThan(desc.indexOf('Book B'));
    });

    test('assigns gold medal to top abandoned book', async () => {
      mockFindMany.mockResolvedValue([makeClubBook(1, { title: 'Unpopular Book' })]);
      mockAll.mockReturnValue([makeLog('alice', 1, 'abandoned')]);

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('shows enrolled count and abandonment ratio', async () => {
      mockFindMany.mockResolvedValue([makeClubBook(1)]);
      mockAll.mockReturnValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('bob',   1, 'finished'),
        makeLog('carol', 1, 'reading'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/3');
    });
  });

  describe('deduplication', () => {
    test('most recent log per userId+bookId determines status', async () => {
      // Two logs for same user+book — first abandoned, then reading (re-run)
      // The deduplicateByLatest picks the LAST one added (reading), so not abandoned
      mockFindMany.mockResolvedValue([makeClubBook(1)]);
      mockAll.mockReturnValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('alice', 1, 'reading'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      // Since the last log for alice+book1 is 'reading', alice's book1 is not abandoned
      expect(getReplyContent(interaction)).toContain('No club reads have been abandoned yet.');
    });
  });

  describe('month/year display', () => {
    test('shows month and year in entry when both are set', async () => {
      mockFindMany.mockResolvedValue([
        makeClubBook(1, { title: 'Test Book', month: 3, year: 2025 }),
      ]);
      mockAll.mockReturnValue([makeLog('alice', 1, 'abandoned')]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('Mar 2025');
    });
  });
});
