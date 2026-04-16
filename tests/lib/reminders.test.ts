jest.mock('../../db', () => ({
  setting:      { findUnique: jest.fn() },
  clubBook:     { findMany: jest.fn() },
  readingLog:   { findMany: jest.fn(), update: jest.fn() },
  reminderQuip: { findMany: jest.fn() },
}));

const db = require('../../db');
const { sendReminders } = require('../../lib/reminders');

const CLUB_BOOK  = { bookId: 1 };
const STALE_LOG  = { id: 10, userId: 'user-1', bookId: 1, threadId: 'thread-1' };
const QUIP       = { id: 1, text: 'Read your book!' };

function makeClient(threadSend = jest.fn().mockResolvedValue()) {
  return {
    channels: {
      fetch: jest.fn().mockResolvedValue({ send: threadSend }),
    },
  };
}

// Pin clubBook.findMany to return the current month/year so queries match
function stubCurrentMonthBotm() {
  const now = new Date();
  db.clubBook.findMany.mockImplementation(({ where }) => {
    if (where.month === now.getMonth() + 1 && where.year === now.getFullYear()) {
      return Promise.resolve([CLUB_BOOK]);
    }
    return Promise.resolve([]);
  });
}

afterEach(() => jest.resetAllMocks());

// ── Setting guard ─────────────────────────────────────────────────────────────

describe('reminders_enabled setting', () => {
  test('does nothing when setting is explicitly disabled', async () => {
    db.setting.findUnique.mockResolvedValue({ key: 'reminders_enabled', value: 'false' });
    await sendReminders(makeClient());
    expect(db.clubBook.findMany).not.toHaveBeenCalled();
  });

  test('proceeds when setting is enabled', async () => {
    db.setting.findUnique.mockResolvedValue({ key: 'reminders_enabled', value: 'true' });
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([]);
    await sendReminders(makeClient());
    expect(db.clubBook.findMany).toHaveBeenCalled();
  });

  test('proceeds when setting row does not exist (default enabled)', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([]);
    await sendReminders(makeClient());
    expect(db.clubBook.findMany).toHaveBeenCalled();
  });
});

// ── No BOTM this month ────────────────────────────────────────────────────────

describe('no BOTM this month', () => {
  test('does nothing when no club books match the current month', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    db.clubBook.findMany.mockResolvedValue([]);
    await sendReminders(makeClient());
    expect(db.readingLog.findMany).not.toHaveBeenCalled();
  });
});

// ── No stale logs ─────────────────────────────────────────────────────────────

describe('no stale logs', () => {
  test('does nothing when no reading logs are overdue', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([]);
    await sendReminders(makeClient());
    expect(db.reminderQuip.findMany).not.toHaveBeenCalled();
  });
});

// ── No quips ──────────────────────────────────────────────────────────────────

describe('no quips in db', () => {
  test('does nothing when quip table is empty', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([STALE_LOG]);
    db.reminderQuip.findMany.mockResolvedValue([]);
    const client = makeClient();
    await sendReminders(client);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('happy path', () => {
  test('sends a quip to the stale log thread', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([STALE_LOG]);
    db.reminderQuip.findMany.mockResolvedValue([QUIP]);
    db.readingLog.update.mockResolvedValue({});
    const threadSend = jest.fn().mockResolvedValue();
    const client = makeClient(threadSend);

    await sendReminders(client);

    expect(client.channels.fetch).toHaveBeenCalledWith('thread-1');
    expect(threadSend).toHaveBeenCalledWith(expect.stringContaining('<@user-1>'));
    expect(threadSend).toHaveBeenCalledWith(expect.stringContaining('Read your book!'));
  });

  test('sets lastRemindedAt on the log after sending', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([STALE_LOG]);
    db.reminderQuip.findMany.mockResolvedValue([QUIP]);
    db.readingLog.update.mockResolvedValue({});
    const client = makeClient();

    await sendReminders(client);

    expect(db.readingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STALE_LOG.id },
        data:  expect.objectContaining({ lastRemindedAt: expect.any(Date) }),
      })
    );
  });

  test('sends reminders across multiple BOTM books in the same month', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    const now = new Date();
    db.clubBook.findMany.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    db.readingLog.findMany.mockResolvedValue([
      { ...STALE_LOG, id: 10, bookId: 1, threadId: 'thread-1' },
      { ...STALE_LOG, id: 11, bookId: 2, threadId: 'thread-2' },
    ]);
    db.reminderQuip.findMany.mockResolvedValue([QUIP]);
    db.readingLog.update.mockResolvedValue({});
    const threadSend = jest.fn().mockResolvedValue();
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send: threadSend }) } };

    await sendReminders(client);

    expect(threadSend).toHaveBeenCalledTimes(2);
    expect(db.readingLog.update).toHaveBeenCalledTimes(2);
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('resilience', () => {
  test('skips logs with no threadId', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([{ ...STALE_LOG, threadId: null }]);
    db.reminderQuip.findMany.mockResolvedValue([QUIP]);
    const client = makeClient();

    await sendReminders(client);

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(db.readingLog.update).not.toHaveBeenCalled();
  });

  test('skips a log when thread fetch fails, continues with others', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    stubCurrentMonthBotm();
    db.readingLog.findMany.mockResolvedValue([
      { ...STALE_LOG, id: 10, threadId: 'thread-bad' },
      { ...STALE_LOG, id: 11, threadId: 'thread-good' },
    ]);
    db.reminderQuip.findMany.mockResolvedValue([QUIP]);
    db.readingLog.update.mockResolvedValue({});
    const threadSend = jest.fn().mockResolvedValue();
    const client = {
      channels: {
        fetch: jest.fn()
          .mockRejectedValueOnce(new Error('Unknown Channel'))
          .mockResolvedValue({ send: threadSend }),
      },
    };

    await sendReminders(client);

    expect(threadSend).toHaveBeenCalledTimes(1);
    expect(db.readingLog.update).toHaveBeenCalledTimes(1);
    expect(db.readingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 11 } })
    );
  });
});
