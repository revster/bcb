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
const { execute } = require('../../commands/club-stats');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInteraction({ user = null as any, year = null as number | null } = {}) {
  return {
    options: {
      getUser:    jest.fn().mockReturnValue(user),
      getInteger: jest.fn().mockReturnValue(year),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply:  jest.fn().mockResolvedValue(undefined),
  };
}

function makeUser(id: string, name: string) {
  return { id, username: name, displayName: name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEmbed(interaction: any) {
  return interaction.editReply.mock.calls[0][0].embeds[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReplyContent(interaction: any) {
  return interaction.editReply.mock.calls[0][0].content;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getField(embed: any, name: string) {
  return embed.data.fields?.find((f: any) => f.name === name);
}

function makeClubBook(bookId: number, month: number, year: number) {
  return { bookId, month, year };
}

function makeLog(userId: string, bookId: number, status: string) {
  return { userId, bookId, status };
}

beforeEach(() => {
  mockAll.mockReturnValue([]);
  resolveUsernames.mockResolvedValue({});
});
afterEach(() => { mockAll.mockReset(); jest.clearAllMocks(); });

// ── Empty states ──────────────────────────────────────────────────────────────

describe('empty states', () => {
  test('no club books at all → no-data message', async () => {
    mockAll
      .mockReturnValueOnce([]) // club books
      .mockReturnValueOnce([]); // logs
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No BOTM data found.');
  });

  test('no club books for specified year → year-specific no-data message', async () => {
    mockAll.mockReturnValueOnce([]);
    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No BOTM data found for 2025.');
  });

  test('club books exist but no logs → no-participation message', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([]);
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No participation data found.');
  });

  test('user specified with no logs (no year) → no-participation message', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });
    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    expect(getReplyContent(interaction)).toContain('No BOTM participation found');
  });
});

// ── Symbols ───────────────────────────────────────────────────────────────────

describe('symbols', () => {
  test('finished shows ✓', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('✓');
  });

  test('dnr shows X', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('X');
  });

  test('abandoned shows A', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('A');
  });

  test('reading shows ?', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'reading')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('?');
  });

  test('no log shows . (not in club)', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025), makeClubBook(2, 2, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]); // u1 has no log for book 2
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('.');
  });

  test('legend contains all four symbols', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
    expect(desc).toContain('X');
    expect(desc).toContain('A');
    expect(desc).toContain('.');
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

/** Extract just the monospace grid from a description (strips legend and fences). */
function getGrid(desc: string): string {
  return desc.match(/```\n([\s\S]*?)\n```/)?.[1] ?? '';
}

describe('deduplication (multiple logs per user+book)', () => {
  test('finished beats dnr', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr'), makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const grid = getGrid(getEmbed(interaction).data.description);
    expect(grid).toContain('✓');
    expect(grid).not.toContain('X');
  });

  test('finished beats abandoned', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned'), makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const grid = getGrid(getEmbed(interaction).data.description);
    expect(grid).toContain('✓');
    expect(grid).not.toContain('A');
  });

  test('abandoned beats dnr', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr'), makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const grid = getGrid(getEmbed(interaction).data.description);
    expect(grid).toContain('A');
    expect(grid).not.toContain('X');
  });
});

// ── Year filter ───────────────────────────────────────────────────────────────

describe('year filter only', () => {
  test('title includes the year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 3, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('2025');
  });

  test('grid is in a code block', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toMatch(/```/);
  });

  test('header shows month abbreviations for club books in that year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025), makeClubBook(2, 6, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('Ja');
    expect(desc).toContain('Jn');
  });

  test('users sorted by finished count descending', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025), makeClubBook(2, 2, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u2', 1, 'finished'),
        makeLog('u2', 2, 'finished'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice', u2: 'bob' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc.indexOf('bob')).toBeLessThan(desc.indexOf('alice'));
  });

  test('all four symbols can appear in the same grid', async () => {
    mockAll
      .mockReturnValueOnce([
        makeClubBook(1, 1, 2025),
        makeClubBook(2, 2, 2025),
        makeClubBook(3, 3, 2025),
        makeClubBook(4, 4, 2025),
      ])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u1', 2, 'abandoned'),
        makeLog('u1', 3, 'dnr'),
        // u1 has no log for book 4 → .
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
    expect(desc).toContain('A');
    expect(desc).toContain('X');
    expect(desc).toContain('.');
  });
});

// ── User filter (all years) ───────────────────────────────────────────────────

describe('user filter only', () => {
  test('title includes the user\'s name', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('alice');
  });

  test('grid is in a code block in description', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toMatch(/```/);
  });

  test('years with no logs for the user are skipped', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2024), makeClubBook(2, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 2, 'finished')]); // only 2025
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('2025');
    expect(desc).not.toContain('2024');
  });

  test('shows year label for each year the user participated in', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2024), makeClubBook(2, 1, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u1', 2, 'finished'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('2024');
    expect(desc).toContain('2025');
  });

  test('user with no logs at all → no-participation message', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([]);
    resolveUsernames.mockResolvedValue({});

    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    expect(getReplyContent(interaction)).toBeTruthy();
  });
});

// ── User + year ───────────────────────────────────────────────────────────────

describe('user + year', () => {
  test('title includes both user name and year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 3, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice'), year: 2025 });
    await execute(interaction);

    const title = getEmbed(interaction).data.title;
    expect(title).toContain('alice');
    expect(title).toContain('2025');
  });

  test('grid is in description as a code block', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice'), year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toMatch(/```/);
  });

  test('shows correct symbol for the user', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice'), year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.description).toContain('A');
  });
});

// ── All time (no args) ────────────────────────────────────────────────────────

describe('all time (no args)', () => {
  test('title says All Time', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('All Time');
  });

  test('one embed field per year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2024), makeClubBook(2, 1, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u1', 2, 'finished'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    const fields = getEmbed(interaction).data.fields;
    expect(fields).toHaveLength(2);
    expect(fields.map((f: any) => f.name)).toContain('2024');
    expect(fields.map((f: any) => f.name)).toContain('2025');
  });

  test('each year field contains a code block', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    const field = getField(getEmbed(interaction), '2025');
    expect(field.value).toMatch(/```/);
  });

  test('users with no logs in a given year are excluded from that year\'s field', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2024), makeClubBook(2, 1, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'), // only in 2024
        makeLog('u2', 2, 'finished'), // only in 2025
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice', u2: 'bob' });

    const interaction = makeInteraction();
    await execute(interaction);

    const field2024 = getField(getEmbed(interaction), '2024');
    const field2025 = getField(getEmbed(interaction), '2025');
    expect(field2024.value).toContain('alice');
    expect(field2024.value).not.toContain('bob');
    expect(field2025.value).toContain('bob');
    expect(field2025.value).not.toContain('alice');
  });

  test('users sorted by total finished count descending within each year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025), makeClubBook(2, 2, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u2', 1, 'finished'),
        makeLog('u2', 2, 'finished'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice', u2: 'bob' });

    const interaction = makeInteraction();
    await execute(interaction);

    const field = getField(getEmbed(interaction), '2025');
    expect(field.value.indexOf('bob')).toBeLessThan(field.value.indexOf('alice'));
  });

  test('legend is shown in description', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction();
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✓');
    expect(desc).toContain('X');
    expect(desc).toContain('A');
    expect(desc).toContain('.');
  });
});
