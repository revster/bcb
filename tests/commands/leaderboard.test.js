jest.mock('../../db', () => ({
  clubBook: { findMany: jest.fn() },
  readingLog: { findMany: jest.fn() },
}));

jest.mock('../../lib/resolveUsernames', () => ({
  resolveUsernames: jest.fn(),
}));

const db = require('../../db');
const { resolveUsernames } = require('../../lib/resolveUsernames');
const { execute } = require('../../commands/leaderboard');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction({ year = null } = {}) {
  return {
    options: { getInteger: jest.fn().mockReturnValue(year) },
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

function getEmbed(interaction) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

function getReplyContent(interaction) {
  return interaction.editReply.mock.calls[0][0].content;
}

afterEach(() => jest.resetAllMocks());

// ── All-time leaderboard ──────────────────────────────────────────────────────

describe('/leaderboard all-time (no year)', () => {
  test('replies with no-data message when there are no club books', async () => {
    db.clubBook.findMany.mockResolvedValue([]);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month completions recorded yet.');
  });

  test('replies with no-data message when there are club books but no finished logs', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
    db.readingLog.findMany.mockResolvedValue([]);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month completions recorded yet.');
  });

  test('shows members ranked by finished club book count', async () => {
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
    // alice should appear before bob
    expect(desc.indexOf('alice')).toBeLessThan(desc.indexOf('bob'));
    expect(desc).toContain('alice');
    expect(desc).toContain('bob');
  });

  test('assigns gold, silver, bronze medals to top 3', async () => {
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
    expect(desc).toContain('🥇');
    expect(desc).toContain('🥈');
    expect(desc).toContain('🥉');
  });

  test('uses numeric rank for positions beyond 3', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'a', bookId: 1, status: 'finished' },
      { userId: 'a', bookId: 2, status: 'finished' },
      { userId: 'b', bookId: 1, status: 'finished' },
      { userId: 'b', bookId: 2, status: 'finished' },
      { userId: 'c', bookId: 1, status: 'finished' },
      { userId: 'c', bookId: 2, status: 'finished' },
      { userId: 'd', bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ a: 'alice', b: 'bob', c: 'carol', d: 'dave' });

    const interaction = makeInteraction();
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('4.');
  });

  test('deduplicates re-reads: two finished logs for same userId:bookId count as 1', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      { userId: 'alice', bookId: 1, status: 'finished' }, // duplicate (re-read or re-run)
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('1 book');
  });

  test('uses singular "book" for count of 1, plural "books" for more', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      { userId: 'alice', bookId: 2, status: 'finished' },
      { userId: 'bob',   bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob' });

    const interaction = makeInteraction();
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('2 books');
    expect(desc).toContain('1 book');
  });

  test('only counts finished logs, not reading or abandoned', async () => {
    // buildAllTime queries with status:'finished' — mock returns only what that query would return
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      // alice's reading log and bob's abandoned log are filtered out by the DB query
      // so the mock only returns the one finished log
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    // Only alice should appear (she has 1 finish); bob has no finished logs returned
    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('alice');
    expect(desc).not.toContain('bob');
  });

  test('embed title says All Time', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('All Time');
  });
});

// ── Year grid leaderboard ─────────────────────────────────────────────────────

describe('/leaderboard year grid', () => {
  test('replies with no-data message when no club books for that year', async () => {
    db.clubBook.findMany.mockResolvedValue([]);
    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
  });

  test('replies with no-data message when club books exist but no logs', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1, month: 1 }]);
    db.readingLog.findMany.mockResolvedValue([]);
    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
  });

  test('description is wrapped in a code block', async () => {
    db.clubBook.findMany.mockResolvedValue([
      { bookId: 1, month: 1 },
    ]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toMatch(/^```/);
    expect(desc).toMatch(/```$/);
  });

  test('shows ✓ for finished and - for not finished', async () => {
    db.clubBook.findMany.mockResolvedValue([
      { bookId: 1, month: 1 },
      { bookId: 2, month: 2 },
    ]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      { userId: 'alice', bookId: 2, status: 'reading' },   // not finished
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
    expect(desc).toContain('-');
  });

  test('embed title includes the year', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1, month: 3 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('2025');
  });

  test('grid header contains month abbreviations for club books', async () => {
    db.clubBook.findMany.mockResolvedValue([
      { bookId: 1, month: 1 },
      { bookId: 2, month: 6 },
    ]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('Jan');
    expect(desc).toContain('Jun');
  });

  test('totals row appears in the grid', async () => {
    db.clubBook.findMany.mockResolvedValue([
      { bookId: 1, month: 1 },
      { bookId: 2, month: 2 },
    ]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      { userId: 'alice', bookId: 2, status: 'finished' },
      { userId: 'bob',   bookId: 1, status: 'finished' },
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice', bob: 'bob' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('Total');
  });

  test('deduplicates re-reads in year grid: finished wins over reading for same userId:bookId', async () => {
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1, month: 1 }]);
    db.readingLog.findMany.mockResolvedValue([
      { userId: 'alice', bookId: 1, status: 'finished' },
      { userId: 'alice', bookId: 1, status: 'reading' }, // re-run log
    ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    // alice should show ✓ not - for book 1
    expect(desc).toContain('✓');
  });
});
