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
const { execute } = require('../../commands/finishers');

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
afterEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/finishers execute', () => {
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

    test('replies with no-completions message when club books exist but nobody finished', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'reading' }]);
      resolveUsernames.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read completions recorded yet.');
    });
  });

  describe('ranking', () => {
    test('ranks members by finished count descending', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 2, status: 'finished' },
          { userId: 'alice', bookId: 3, status: 'finished' },
          { userId: 'bob',   bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc.indexOf('alice')).toBeLessThan(desc.indexOf('bob'));
    });

    test('assigns gold medal to top finisher', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('assigns silver and bronze medals to 2nd and 3rd', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 2, status: 'finished' },
          { userId: 'alice', bookId: 3, status: 'finished' },
          { userId: 'bob',   bookId: 1, status: 'finished' },
          { userId: 'bob',   bookId: 2, status: 'finished' },
          { userId: 'carol', bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob', carol: 'carol' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('🥈');
      expect(desc).toContain('🥉');
    });

    test('uses competition ranking for ties: 1, 1, 3 — tied rank 1s get gold, next gets bronze', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 2, status: 'finished' },
          { userId: 'bob',   bookId: 1, status: 'finished' },
          { userId: 'bob',   bookId: 2, status: 'finished' },
          { userId: 'carol', bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob', carol: 'carol' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      const goldCount = (desc.match(/🥇/g) || []).length;
      expect(goldCount).toBe(2);
      expect(desc).toContain('🥉');
      expect(desc).not.toContain('🥈');
    });

    test('shows enrolled count and completion rate in each row', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 2, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('2/2');
      expect(desc).toContain('100%');
    });
  });

  describe('deduplication', () => {
    test('finished + reading for same book counts as 1 finished', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 1, status: 'reading' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/1');
      expect(desc).toContain('100%');
    });

    test('abandoned + reading for same book counts as 0 finished', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'abandoned' },
          { userId: 'alice', bookId: 1, status: 'reading' },
        ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read completions recorded yet.');
    });

    test('two finished logs for same book count as 1 finished', async () => {
      mockAll
        .mockReturnValueOnce([{ bookId: 1 }])
        .mockReturnValueOnce([
          { userId: 'alice', bookId: 1, status: 'finished' },
          { userId: 'alice', bookId: 1, status: 'finished' },
        ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/1');
    });
  });

  describe('year filter', () => {
    test('uses year filter when provided', async () => {
      mockAll.mockReturnValueOnce([]); // empty for year 2024
      const interaction = makeInteraction({ year: 2024 });
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('2024');
    });
  });
});
