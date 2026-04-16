jest.mock('../../db', () => ({
  memberChannel: { upsert: jest.fn() },
}));

const db = require('../../db');
const { ChannelType, MessageFlags } = require('discord.js');
const { execute } = require('../../commands/register');

function makeInteraction({ userId = '111', displayName = 'Alice', channelId = 'ch-forum', channelType = ChannelType.GuildForum } = {}) {
  return {
    options: {
      getUser: jest.fn().mockReturnValue({ id: userId, displayName, username: displayName.toLowerCase() }),
      getChannel: jest.fn().mockReturnValue({ id: channelId, type: channelType }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/register execute', () => {
  test('rejects a non-forum channel', async () => {
    const interaction = makeInteraction({ channelType: ChannelType.GuildText });
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not a forum channel') })
    );
    expect(db.memberChannel.upsert).not.toHaveBeenCalled();
  });

  test('upserts a MemberChannel record for a forum channel', async () => {
    db.memberChannel.upsert.mockResolvedValue({});
    const interaction = makeInteraction({ userId: '111', displayName: 'Alice', channelId: 'ch-forum' });
    await execute(interaction);

    expect(db.memberChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: '111' },
        create: expect.objectContaining({ userId: '111', channelId: 'ch-forum' }),
        update: expect.objectContaining({ channelId: 'ch-forum' }),
      })
    );
  });

  test('reply is ephemeral and mentions the user and channel', async () => {
    db.memberChannel.upsert.mockResolvedValue({});
    const interaction = makeInteraction({ userId: '111', channelId: 'ch-forum' });
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining('<@111>'),
      })
    );
    const content = interaction.reply.mock.calls[0][0].content;
    expect(content).toContain('<#ch-forum>');
  });
});
