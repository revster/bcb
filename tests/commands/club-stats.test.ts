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

function makeInteraction({ user = null as any, year = 2025 } = {}) {
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
  test('no club books for year → year-specific no-data message', async () => {
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

  test('user specified with no logs → field with all ➖', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });
    const interaction = makeInteraction({ user: makeUser('u1', 'alice') });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field).toBeDefined();
    expect(field.value).toContain('➖');
    expect(field.value).not.toContain('✅');
  });
});

// ── Emojis ────────────────────────────────────────────────────────────────────

describe('emojis', () => {
  test('finished shows ✅ in the correct month', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])  // January
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Jan ✅');
  });

  test('dnr shows ❌ in the correct month', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 3, 2025)])  // March
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Mar ❌');
  });

  test('abandoned shows 💀 in the correct month', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 6, 2025)])  // June
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Jun 💀');
  });

  test('month with no BOTM book shows ➖', async () => {
    // Only January has a BOTM — February should show ➖
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Feb ➖');
  });

  test('legend contains all four emojis', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const desc = getEmbed(interaction).data.description;
    expect(desc).toContain('✅');
    expect(desc).toContain('💀');
    expect(desc).toContain('❌');
    expect(desc).toContain('➖');
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('deduplication (multiple logs per user+book)', () => {
  test('finished beats dnr', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr'), makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Jan ✅');
    expect(field.value).not.toContain('Jan ❌');
  });

  test('finished beats abandoned', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned'), makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Jan ✅');
    expect(field.value).not.toContain('Jan 💀');
  });

  test('abandoned beats dnr', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'dnr'), makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Jan 💀');
    expect(field.value).not.toContain('Jan ❌');
  });
});

// ── Year only (all users) ─────────────────────────────────────────────────────

describe('year only (all users)', () => {
  test('title includes the year', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 3, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    expect(getEmbed(interaction).data.title).toContain('2025');
  });

  test('one field per user', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u2', 1, 'dnr'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice', u2: 'bob' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const fields = getEmbed(interaction).data.fields;
    expect(fields).toHaveLength(2);
    expect(fields.map((f: any) => f.name)).toContain('alice');
    expect(fields.map((f: any) => f.name)).toContain('bob');
  });

  test('field value has two rows split at month 6', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    const lines = field.value.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Jan');
    expect(lines[0]).toContain('Jun');
    expect(lines[1]).toContain('Jul');
    expect(lines[1]).toContain('Dec');
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

    const fields = getEmbed(interaction).data.fields;
    const names = fields.map((f: any) => f.name);
    expect(names.indexOf('bob')).toBeLessThan(names.indexOf('alice'));
  });

  test('all four emojis can appear in the same field', async () => {
    mockAll
      .mockReturnValueOnce([
        makeClubBook(1, 1, 2025),
        makeClubBook(2, 2, 2025),
        makeClubBook(3, 3, 2025),
        // month 4 has no BOTM → ➖
      ])
      .mockReturnValueOnce([
        makeLog('u1', 1, 'finished'),
        makeLog('u1', 2, 'abandoned'),
        makeLog('u1', 3, 'dnr'),
      ]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ year: 2025 });
    await execute(interaction);

    const value = getField(getEmbed(interaction), 'alice').value;
    expect(value).toContain('✅');
    expect(value).toContain('💀');
    expect(value).toContain('❌');
    expect(value).toContain('➖');
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

  test('one field for that user only', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 1, 2025)])
      .mockReturnValueOnce([makeLog('u1', 1, 'finished')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice'), year: 2025 });
    await execute(interaction);

    const fields = getEmbed(interaction).data.fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('alice');
  });

  test('shows correct emoji for the user', async () => {
    mockAll
      .mockReturnValueOnce([makeClubBook(1, 4, 2025)])  // April
      .mockReturnValueOnce([makeLog('u1', 1, 'abandoned')]);
    resolveUsernames.mockResolvedValue({ u1: 'alice' });

    const interaction = makeInteraction({ user: makeUser('u1', 'alice'), year: 2025 });
    await execute(interaction);

    const field = getField(getEmbed(interaction), 'alice');
    expect(field.value).toContain('Apr 💀');
  });
});
