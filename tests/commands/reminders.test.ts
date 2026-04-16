jest.mock('../../db', () => ({
  setting: { findUnique: jest.fn(), upsert: jest.fn() },
}));

const db = require('../../db');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../commands/reminders');

function makeInteraction(subcommand) {
  return {
    options: { getSubcommand: jest.fn().mockReturnValue(subcommand) },
    reply: jest.fn().mockResolvedValue(),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/reminders enable', () => {
  test('upserts reminders_enabled = true', async () => {
    db.setting.upsert.mockResolvedValue({});
    await execute(makeInteraction('enable'));
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'reminders_enabled' }, update: { value: 'true' }, create: { key: 'reminders_enabled', value: 'true' } })
    );
  });

  test('replies ephemerally confirming enabled', async () => {
    db.setting.upsert.mockResolvedValue({});
    const interaction = makeInteraction('enable');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });
});

describe('/reminders disable', () => {
  test('upserts reminders_enabled = false', async () => {
    db.setting.upsert.mockResolvedValue({});
    await execute(makeInteraction('disable'));
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 'false' }, create: { key: 'reminders_enabled', value: 'false' } })
    );
  });

  test('replies ephemerally confirming disabled', async () => {
    db.setting.upsert.mockResolvedValue({});
    const interaction = makeInteraction('disable');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('disabled'), flags: MessageFlags.Ephemeral })
    );
  });
});

describe('/reminders status', () => {
  test('reports enabled when setting value is true', async () => {
    db.setting.findUnique.mockResolvedValue({ value: 'true' });
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });

  test('reports disabled when setting value is false', async () => {
    db.setting.findUnique.mockResolvedValue({ value: 'false' });
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('disabled'), flags: MessageFlags.Ephemeral })
    );
  });

  test('reports enabled when setting row does not exist (default)', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    const interaction = makeInteraction('status');
    await execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('enabled'), flags: MessageFlags.Ephemeral })
    );
  });
});
