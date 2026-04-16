jest.mock('../../db', () => ({
  clubBook: { findMany: jest.fn() },
  readingLog: { findMany: jest.fn() },
}));

const db = require('../../db');
const { execute } = require('../../commands/abandoned');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction() {
  return {
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

function makeClubBook(bookId, { title = 'Book', author = 'Author', month = null, year = null } = {}) {
  return { bookId, month, year, book: { title, author } };
}

function makeLog(userId, bookId, status) {
  return { userId, bookId, status };
}

function getEmbed(interaction) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

function getReplyContent(interaction) {
  return interaction.editReply.mock.calls[0][0].content;
}

afterEach(() => jest.resetAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/abandoned execute', () => {
  describe('no data', () => {
    test('replies with no-data message when no club books exist', async () => {
      db.clubBook.findMany.mockResolvedValue([]);
      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No Book of the Month data found.');
    });

    test('replies with no-abandonments message when nobody abandoned any club book', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1)]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'finished'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getReplyContent(interaction)).toContain('No club reads have been abandoned yet.');
    });
  });

  describe('ranking', () => {
    test('ranks books by abandoned count descending', async () => {
      db.clubBook.findMany.mockResolvedValue([
        makeClubBook(1, { title: 'Popular Abandon' }),
        makeClubBook(2, { title: 'Less Abandoned' }),
      ]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('bob',   1, 'abandoned'),
        makeLog('carol', 1, 'abandoned'),
        makeLog('alice', 2, 'abandoned'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc.indexOf('Popular Abandon')).toBeLessThan(desc.indexOf('Less Abandoned'));
    });

    test('assigns gold medal to most-abandoned book', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1, { title: 'Bad Book' })]);
      db.readingLog.findMany.mockResolvedValue([makeLog('alice', 1, 'abandoned')]);

      const interaction = makeInteraction();
      await execute(interaction);

      expect(getEmbed(interaction).data.description).toContain('🥇');
    });

    test('uses competition ranking for ties: 1, 1, 3 — tied rank 1s get gold, next gets bronze', async () => {
      db.clubBook.findMany.mockResolvedValue([
        makeClubBook(1, { title: 'Book A' }),
        makeClubBook(2, { title: 'Book B' }),
        makeClubBook(3, { title: 'Book C' }),
      ]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('alice', 2, 'abandoned'),
        makeLog('bob',   1, 'abandoned'),
        makeLog('bob',   2, 'abandoned'),
        makeLog('carol', 3, 'abandoned'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      // Book A and Book B both tied at 2 abandonments → both get 🥇; Book C skips to rank 3 → 🥉
      const goldCount = (desc.match(/🥇/g) || []).length;
      expect(goldCount).toBe(2);
      expect(desc).toContain('🥉');   // Book C is rank 3
      expect(desc).not.toContain('🥈'); // nobody is rank 2
    });

    test('shows x/y abandoned ratio for each book', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1, { title: 'Half Abandoned' })]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('bob',   1, 'finished'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('1/2 abandoned');
    });

    test('omits books with zero abandonments', async () => {
      db.clubBook.findMany.mockResolvedValue([
        makeClubBook(1, { title: 'Loved Book' }),
        makeClubBook(2, { title: 'Hated Book' }),
      ]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'finished'),
        makeLog('alice', 2, 'abandoned'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('Hated Book');
      expect(desc).not.toContain('Loved Book');
    });
  });

  describe('month/year display', () => {
    test('shows month and year abbreviation when both set on club book', async () => {
      db.clubBook.findMany.mockResolvedValue([
        makeClubBook(1, { title: 'Jan Read', month: 1, year: 2025 }),
      ]);
      db.readingLog.findMany.mockResolvedValue([makeLog('alice', 1, 'abandoned')]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('Jan 2025');
    });

    test('omits month/year when not set on club book', async () => {
      db.clubBook.findMany.mockResolvedValue([
        makeClubBook(1, { title: 'Timeless Book' }),
      ]);
      db.readingLog.findMany.mockResolvedValue([makeLog('alice', 1, 'abandoned')]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      // No parenthetical date should appear
      expect(desc).not.toMatch(/\(\w{3} \d{4}\)/);
    });
  });

  describe('deduplication', () => {
    test('finished + abandoned for same userId:bookId counts as not abandoned', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1)]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('alice', 1, 'finished'), // later log: actually finished
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      // The later log (finished) wins — alice should not count as abandoned
      expect(getReplyContent(interaction)).toContain('No club reads have been abandoned yet.');
    });

    test('two users abandoning same book counts as 2 abandonments', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1, { title: 'Tough Book' })]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('bob',   1, 'abandoned'),
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      expect(desc).toContain('2/2 abandoned');
    });

    test('duplicate logs for same userId:bookId count as one', async () => {
      db.clubBook.findMany.mockResolvedValue([makeClubBook(1)]);
      db.readingLog.findMany.mockResolvedValue([
        makeLog('alice', 1, 'abandoned'),
        makeLog('alice', 1, 'abandoned'), // exact duplicate
      ]);

      const interaction = makeInteraction();
      await execute(interaction);

      const desc = getEmbed(interaction).data.description;
      // enrolled should be 1 (deduplicated), abandoned 1
      expect(desc).toContain('1/1 abandoned');
    });
  });
});
