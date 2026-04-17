// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockAll = jest.fn();

jest.mock('../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    all:     mockAll,
  };
  return {
    select: jest.fn(() => chain),
  };
});

const { execute } = require('../../commands/checkup');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMBER_A = { userId: '111', username: 'alice', channelId: 'ch-alice' };
const MEMBER_B = { userId: '222', username: 'bob',   channelId: 'ch-bob' };

function makeForumChannel(tagNames: string[] = []) {
  return {
    availableTags: tagNames.map((name, i) => ({ id: `tag-${i}`, name })),
  };
}

function makeInteraction(fetchImpl: (id: string) => Promise<any>) {
  return {
    guild: {
      channels: { fetch: jest.fn().mockImplementation(fetchImpl) },
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply:  jest.fn().mockResolvedValue(undefined),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReplied(interaction: any): string {
  return interaction.editReply.mock.calls[0][0];
}

afterEach(() => { mockAll.mockReset(); jest.clearAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/checkup execute', () => {
  test('replies with no-members message when table is empty', async () => {
    mockAll.mockReturnValue([]);
    const interaction = makeInteraction(() => Promise.resolve(null));
    await execute(interaction);
    expect(getReplied(interaction)).toBe('No registered members found.');
  });

  test('reports healthy when all members have valid channels with required tags', async () => {
    mockAll.mockReturnValue([MEMBER_A, MEMBER_B]);
    const fullChannel = makeForumChannel(['Bot', 'Book of the Month', 'Completed', 'Abandoned']);
    const interaction = makeInteraction(() => Promise.resolve(fullChannel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('All 2 registered members are healthy.');
    expect(reply).not.toContain('⚠️');
  });

  test('reports channel-not-found for a member whose channel is missing', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const interaction = makeInteraction(() => Promise.resolve(null));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('channel not found');
  });

  test('reports missing Bot tag', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const channel = makeForumChannel(['Book of the Month', 'Completed', 'Abandoned']);
    const interaction = makeInteraction(() => Promise.resolve(channel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('Bot');
  });

  test('reports missing Book of the Month tag', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const channel = makeForumChannel(['Bot', 'Completed', 'Abandoned']);
    const interaction = makeInteraction(() => Promise.resolve(channel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('Book of the Month');
  });

  test('reports missing Completed tag', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const channel = makeForumChannel(['Bot', 'Book of the Month', 'Abandoned']);
    const interaction = makeInteraction(() => Promise.resolve(channel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('Completed');
  });

  test('reports missing Abandoned tag', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const channel = makeForumChannel(['Bot', 'Book of the Month', 'Completed']);
    const interaction = makeInteraction(() => Promise.resolve(channel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('Abandoned');
  });

  test('reports all missing tags when channel has no tags', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const channel = makeForumChannel([]);
    const interaction = makeInteraction(() => Promise.resolve(channel));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('Bot');
    expect(reply).toContain('Book of the Month');
    expect(reply).toContain('Completed');
    expect(reply).toContain('Abandoned');
  });

  test('reports issues count in header', async () => {
    mockAll.mockReturnValue([MEMBER_A, MEMBER_B]);
    // alice is fine, bob's channel is missing
    const fullChannel = makeForumChannel(['Bot', 'Book of the Month', 'Completed', 'Abandoned']);
    const interaction = makeInteraction((id: string) =>
      id === 'ch-alice' ? Promise.resolve(fullChannel) : Promise.resolve(null)
    );
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('1/2');
    expect(reply).toContain('bob');
    expect(reply).not.toContain('alice');
  });

  test('handles fetch rejection gracefully (treats as not found)', async () => {
    mockAll.mockReturnValue([MEMBER_A]);
    const interaction = makeInteraction(() => Promise.reject(new Error('Unknown Channel')));
    await execute(interaction);
    const reply = getReplied(interaction);
    expect(reply).toContain('alice');
    expect(reply).toContain('channel not found');
  });
});
