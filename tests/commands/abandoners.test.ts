// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockAll = jest.fn();

jest.mock('../../db', () => {
  const chain: any = {
    from:  jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    all:   mockAll,
  };
  return {
    select: jest.fn(() => chain),
    query: {},
  };
});

jest.mock('../../lib/resolveUsernames', () => ({
  resolveUsernames: jest.fn(),
}));

const { resolveUsernames } = require('../../lib/resolveUsernames');
const { execute } = require('../../commands/abandoners');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction({ year = null as number | null } = {}) {
  return {
    options: { getInteger: jest.fn().mockReturnValue(year) },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply:  jest.fn().mockResolvedValue(undefined),
  };
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
afterEach(() => { mockAll.mockReset(); jest.clearAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/abandoners execute', () => {
  describe('no data', () => {
    test('replies with no-data message when no club books exist', async () => {
      mockAll.mockReturnValueOnce([]); // clubBooks → empty
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found.');
    });

    test('replies with year-specific no-data message when year provided', async () => {
      mockAll.mockReturnValueOnce([]); // clubBooks → empty
      const interaction = makeInteraction({ year: 2025 });
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
    });

    test('replies with no-abandonments message when nobody has abandoned', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])                         // clubBooks
        .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]); // readingLogs
      resolveUsernames.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });
  });

  describe('ranking', () => {
    test('ranks members by abandoned count descending', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'alice', bookId: 2, status: 'abandoned' },
          { userId: 'bob',   bookId: 1, status: 'abandoned' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc.indexOf('alice')).toBeLessThan(desc.indexOf('bob'));
    });

    test('assigns gold medal to top abandoner', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'abandoned' }]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('uses competition ranking for ties: 1, 1, 3', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'bob',   bookId: 2, status: 'abandoned' },
          { userId: 'carol', bookId: 1, status: 'abandoned' },
          { userId: 'carol', bookId: 2, status: 'abandoned' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob', carol: 'carol' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('🥇');  // carol (2)
      // alice and bob tied at 1 — both get rank 2 (medal)
      expect(desc).toContain('🥈');
    });

    test('shows enrolled count and abandonment rate in each row', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'bob',   bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('alice');
      expect(desc).toContain('1/1');
    });

    test('only shows members who have at least one abandonment', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'bob',   bookId: 1, status: 'abandoned' },
        ]);
      resolveUsernames.mockResolvedValue({ bob: 'bob' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).not.toContain('alice');
      expect(desc).toContain('bob');
    });
  });

  describe('deduplication', () => {
    test('finished + abandoned for same book counts as 0 abandoned (finished wins)', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'alice', bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });

    test('reading + abandoned for same book counts as 0 abandoned (reading wins)', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'alice', bookId: 1, status: 'reading' },
        ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });
  });
});
