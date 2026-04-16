jest.mock('../../db', () => ({
  clubBook: { findMany: jest.fn() },
  readingLog: { findMany: jest.fn() },
}));

jest.mock('../../lib/resolveUsernames', () => ({
  resolveUsernames: jest.fn(),
}));

const db = require('../../db');
const { resolveUsernames } = require('../../lib/resolveUsernames');
const { execute } = require('../../commands/finishers');

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

describe('/finishers execute', () => {
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

    test('replies with no-completions message when club books exist but nobody finished', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'reading' },
      ]);
      resolveUsernames.mockResolvedValue({});
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read completions recorded yet.');
    });
  });

  describe('ranking', () => {
    test('ranks members by finished count descending', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
      db.readingLog.findMany.mockResolvedValue([
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
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'finished' },
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('assigns silver and bronze medals to 2nd and 3rd', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
      db.readingLog.findMany.mockResolvedValue([
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
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      db.readingLog.findMany.mockResolvedValue([
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
      // alice and bob both tied at rank 1 → both get 🥇; carol skips to rank 3 → gets 🥉 not 🥈
      const goldCount = (desc.match(/🥇/g) || []).length;
      expect(goldCount).toBe(2);
      expect(desc).toContain('🥉');   // carol is rank 3
      expect(desc).not.toContain('🥈'); // nobody is rank 2
    });

    test('shows enrolled count and completion rate in each row', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
      db.readingLog.findMany.mockResolvedValue([
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
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'finished' },
        { userId: 'alice', bookId: 1, status: 'reading' }, // re-run club-start
      ]);
      resolveUsernames.mockResolvedValue({ alice: 'alice' });

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/1');
      expect(desc).toContain('100%');
    });

    test('abandoned + reading for same book counts as 0 finished (member not in output)', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'abandoned' },
        { userId: 'alice', bookId: 1, status: 'reading' },
      ]);
      resolveUsernames.mockResolvedValue({});

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club read completions recorded yet.');
    });

    test('two finished logs for same book count as 1 finished', async () => {
      db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
      db.readingLog.findMany.mockResolvedValue([
        { userId: 'alice', bookId: 1, status: 'finished' },
        { userId: 'alice', bookId: 1, status: 'finished' }, // exact duplicate
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
