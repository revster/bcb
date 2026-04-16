// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
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
    query: {},
  };
});

jest.mock('../../lib/resolveUsernames', () => ({
  resolveUsernames: jest.fn(),
}));

const { resolveUsernames } = require('../../lib/resolveUsernames');
const { execute } = require('../../commands/leaderboard');

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

// ── All-time leaderboard ──────────────────────────────────────────────────────

describe('/leaderboard all-time (no year)', () => {
  test('replies with no-data message when there are no club books', async () => {
    mockAll.mockReturnValueOnce([]); // clubBooks → empty
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month completions recorded yet.');
  });

  test('replies with no-data message when there are club books but no finished logs', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }]) // clubBooks
      .mockReturnValueOnce([]);              // readingLogs → empty
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month completions recorded yet.');
  });

  test('shows members ranked by finished club book count', async () => {
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
    expect(desc).toContain('alice');
    expect(desc).toContain('bob');
  });

  test('assigns gold, silver, bronze medals to top 3', async () => {
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
    expect(desc).toContain('🥇');
    expect(desc).toContain('🥈');
    expect(desc).toContain('🥉');
  });

  test('uses numeric rank for positions beyond 3', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
      .mockReturnValueOnce([
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
    expect(desc).toContain('1 book');
  });

  test('uses singular "book" for count of 1, plural "books" for more', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
      .mockReturnValueOnce([
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
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }])
      .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('alice');
    expect(desc).not.toContain('bob');
  });

  test('embed title says All Time', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }])
      .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('All Time');
  });
});

// ── Year grid leaderboard ─────────────────────────────────────────────────────

describe('/leaderboard year grid', () => {
  test('replies with no-data message when no club books for that year', async () => {
    mockAll.mockReturnValueOnce([]); // clubBooks → empty
    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
  });

  test('replies with no-data message when club books exist but no logs', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }])
      .mockReturnValueOnce([]); // readingLogs → empty
    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No Book of the Month data found for 2025.');
  });

  test('description is wrapped in a code block', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }])
      .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toMatch(/^```/);
    expect(desc).toMatch(/```$/);
  });

  test('shows ✓ for finished and - for not finished', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }, { bookId: 2, month: 2 }])
      .mockReturnValueOnce([
        { userId: 'alice', bookId: 1, status: 'finished' },
        { userId: 'alice', bookId: 2, status: 'reading' },
      ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
    expect(desc).toContain('-');
  });

  test('embed title includes the year', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 3 }])
      .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('2025');
  });

  test('grid header contains month abbreviations for club books', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }, { bookId: 2, month: 6 }])
      .mockReturnValueOnce([{ userId: 'alice', bookId: 1, status: 'finished' }]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('Jan');
    expect(desc).toContain('Jun');
  });

  test('totals row appears in the grid', async () => {
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }, { bookId: 2, month: 2 }])
      .mockReturnValueOnce([
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
    mockAll
      .mockReturnValueOnce([{ bookId: 1, month: 1 }])
      .mockReturnValueOnce([
        { userId: 'alice', bookId: 1, status: 'finished' },
        { userId: 'alice', bookId: 1, status: 'reading' },
      ]);
    resolveUsernames.mockResolvedValue({ alice: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
  });
});
