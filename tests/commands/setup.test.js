jest.mock('../../db', () => ({
  nominationPeriod: { upsert: jest.fn() },
}));

const db = require('../../db');
const { execute } = require('../../commands/setup');

function makeInteraction({ month, year, nominator = null }) {
  return {
    options: {
      getInteger: jest.fn(name => ({ month, year }[name])),
      getUser: jest.fn().mockReturnValue(nominator),
    },
    reply: jest.fn().mockResolvedValue(),
  };
}

afterEach(() => jest.resetAllMocks());

describe('/setup execute', () => {
  test('creates an open-to-all period when no nominator is given', async () => {
    db.nominationPeriod.upsert.mockResolvedValue({ month: 5, year: 2025, openToAll: true, nominatorId: null });
    const interaction = makeInteraction({ month: 5, year: 2025 });
    await execute(interaction);

    expect(db.nominationPeriod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ openToAll: true, nominatorId: null }),
      })
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('open to everyone') })
    );
  });

  test('creates a restricted period when a nominator is given', async () => {
    const nominator = { id: '123456789', displayName: 'BookWorm' };
    db.nominationPeriod.upsert.mockResolvedValue({ month: 5, year: 2025, openToAll: false, nominatorId: '123456789' });
    const interaction = makeInteraction({ month: 5, year: 2025, nominator });
    await execute(interaction);

    expect(db.nominationPeriod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ openToAll: false, nominatorId: '123456789', nominatorName: 'BookWorm' }),
      })
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('<@123456789>') })
    );
  });

  test('reply includes the correct month name and year', async () => {
    db.nominationPeriod.upsert.mockResolvedValue({ month: 12, year: 2025, openToAll: true, nominatorId: null });
    const interaction = makeInteraction({ month: 12, year: 2025 });
    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('December 2025') })
    );
  });

  test('upserts using the month+year composite key', async () => {
    db.nominationPeriod.upsert.mockResolvedValue({ month: 1, year: 2026, openToAll: true, nominatorId: null });
    const interaction = makeInteraction({ month: 1, year: 2026 });
    await execute(interaction);

    expect(db.nominationPeriod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { month_year: { month: 1, year: 2026 } },
      })
    );
  });
});
