// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockRun = jest.fn().mockReturnValue({ changes: 1 });

jest.mock('../../db', () => {
  const chain: any = {
    from:               jest.fn().mockReturnThis(),
    where:              jest.fn().mockReturnThis(),
    values:             jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    run:                mockRun,
  };
  return {
    insert: jest.fn(() => chain),
    query: {},
  };
});

const db = require('../../db');
const { ChannelType, MessageFlags } = require('discord.js');
const { execute } = require('../../commands/register');

function makeInteraction({ userId = '111', displayName = 'Alice', channelId = 'ch-forum', channelType = ChannelType.GuildForum } = {}) {
  return {
    options: {
      getUser:    jest.fn().mockReturnValue({ id: userId, displayName, username: displayName.toLowerCase() }),
      getChannel: jest.fn().mockReturnValue({ id: channelId, type: channelType }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => jest.clearAllMocks());

describe('/register execute', () => {
  test('rejects a non-forum channel', async () => {
    const interaction = makeInteraction({ channelType: ChannelType.GuildText });
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not a forum channel') })
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  test('upserts a MemberChannel record for a forum channel', async () => {
    const interaction = makeInteraction({ userId: '111', displayName: 'Alice', channelId: 'ch-forum' });
    await execute(interaction);

    expect(db.insert).toHaveBeenCalled();
  });

  test('reply is ephemeral and mentions the user and channel', async () => {
    const interaction = makeInteraction({ userId: '111', channelId: 'ch-forum' });
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags:   MessageFlags.Ephemeral,
        content: expect.stringContaining('<@111>'),
      })
    );
    const content = interaction.reply.mock.calls[0][0].content;
    expect(content).toContain('<#ch-forum>');
  });
});
