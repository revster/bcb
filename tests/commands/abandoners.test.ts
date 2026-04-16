jest.mock('../../db', () => ({
  clubBook: { findMany: jest.fn() },
  readingLog: { findMany: jest.fn() },
}));

jest.mock('../../lib/resolveUsernames', () => ({
  resolveUsernames: jest.fn(),
}));

const db = require('../../db');
const { resolveUsernames } = require('../../lib/resolveUsernames');
const { execute } = require('../../commands/abandoners');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction({ year = null as number | null } = {}) {
  return {
    options: { getInteger: jest.fn().mockReturnValue(year) },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
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

afterEach(() => jest.resetAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/abandoners execute', () => {
  describe('no data', () => {
    test('replies with no-data message when no club books exist', async () => {
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found.');
    });

    test('replies with year-specific no-data message when year provided', async () => {
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction({ year: 2025 });
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
    });

    test('replies with no-abandonments message when nobody has abandoned', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'finished' },
      ]);
      resolveUsernames.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });
  });

  describe('ranking', () => {
    test('ranks members by abandoned count descending', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 2, status: 'abandoned' },
        { userId: 'alice', bookId: 3, status: 'abandoned' },
        { userId: 'bob',   bookId: 1, status: 'abandoned' },
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc.indexOf('alice')).toBeLessThan(desc.indexOf('bob'));
    });

    test('assigns gold medal to top abandoner', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('uses competition ranking for ties: 1, 1, 3 — tied rank 1s get gold, next gets bronze', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 2, status: 'abandoned' },
        { userId: 'bob',   bookId: 1, status: 'abandoned' },
        { userId: 'bob',   bookId: 2, status: 'abandoned' },
        { userId: 'carol', bookId: 1, status: 'abandoned' },
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob', carol: 'carol' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      // alice and bob both tied at rank 1 → both get 🥇; carol skips to rank 3 → gets 🥉 not 🥈
      const goldCount = (desc.match(/🥇/g) || []).length;
      expect(goldCount).toBe(2);
      expect(desc).toContain('🥉');   // carol is rank 3
      expect(desc).not.toContain('🥈'); // nobody is rank 2
    });

    test('shows enrolled count and abandonment rate in each row', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 2, status: 'finished' }, // enrolled but not abandoned
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/2');
      expect(desc).toContain('50%');
    });

    test('only shows members who have at least one abandonment', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice',   bookId: 1, status: 'abandoned' },
        { userId: 'finisher', bookId: 2, status: 'finished' },
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('alice');
      expect(desc).not.toContain('finisher');
    });
  });

  describe('deduplication', () => {
    test('finished + abandoned for same book counts as 0 abandoned (finished wins)', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 1, status: 'finished' }, // finished wins
      ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });

    test('reading + abandoned for same book counts as 0 abandoned (reading wins)', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 1, status: 'reading' }, // reading wins over abandoned
      ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read abandonments recorded yet.');
    });

    test('two abandoned logs for same book count as 1 abandonment', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 1, status: 'abandoned' }, // duplicate
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/1');
    });
  });

  describe('year filter', () => {
    test('passes year to clubBook.findMany query', async () => {
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction({ year: 2024 });
      await execute(interaction);

      expect(db.clubBook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { year: 2024 } })
      );
    });

    test('passes empty where when no year provided', async () => {
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(db.clubBook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });
  });
});
