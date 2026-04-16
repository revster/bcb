// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockGet = jest.fn();
const mockRun = jest.fn().mockReturnValue({ changes: 1 });

jest.mock('../../db', () => {
  const chain: any = {
    from:               jest.fn().mockReturnThis(),
    where:              jest.fn().mockReturnThis(),
    values:             jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    get:                mockGet,
    run:                mockRun,
  };
  return {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    query: {},
  };
});

const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/reminders');

function makeInteraction(subcommand: string) {
  return {
    options: { getSubcommand: jest.fn().mockReturnValue(subcommand) },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => jest.clearAllMocks());

describe('/reminders enable', () => {
  test('upserts reminders_enabled = true', async () => {
    const db = require('../../db');
    await execute(makeInteraction('enable'));
    expect(db.insert).toHaveBeenCalled();
  });

  test('replies ephemerally confirming enabled', async () => {
    const interaction = makeInteraction('enable');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });
});

describe('/reminders disable', () => {
  test('upserts reminders_enabled = false', async () => {
    const db = require('../../db');
    await execute(makeInteraction('disable'));
    expect(db.insert).toHaveBeenCalled();
  });

  test('replies ephemerally confirming disabled', async () => {
    const interaction = makeInteraction('disable');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('disabled'), flags: MessageFlags.Ephemeral })
    );
  });
});

describe('/reminders status', () => {
  test('reports enabled when setting value is true', async () => {
    mockGet.mockReturnValueOnce({ value: 'true' });
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });

  test('reports disabled when setting value is false', async () => {
    mockGet.mockReturnValueOnce({ value: 'false' });
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('disabled'), flags: MessageFlags.Ephemeral })
    );
  });

  test('reports enabled when setting row does not exist (default)', async () => {
    mockGet.mockReturnValueOnce(undefined);
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });
});
