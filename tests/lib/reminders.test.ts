// Mock vars prefixed with 'mock' are accessible inside jest.mock() factory
const mockGet = jest.fn();
const mockAll = jest.fn();
const mockRun = jest.fn().mockReturnValue({ changes: 1 });

jest.mock('../../db', () => {
  const chain: any = {
    from:    jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    set:     jest.fn().mockReturnThis(),
    get:     mockGet,
    all:     mockAll,
    run:     mockRun,
  };
  return {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    query: {},
  };
});

const { sendReminders } = require('../../lib/reminders');

const CLUB_BOOK  = { bookId: 1 };
const STALE_LOG  = { id: 10, userId: 'user-1', bookId: 1, threadId: 'thread-1' };
const QUIP       = { id: 1, text: 'Read your book!' };

function makeClient(threadSend = jest.fn().mockResolvedValue(undefined)) {
  return {
    channels: {
      fetch: jest.fn().mockResolvedValue({ send: threadSend }),
    },
  };
}

beforeEach(() => {
  mockGet.mockReturnValue(undefined);
  mockAll.mockReturnValue([]);
  mockRun.mockReturnValue({ changes: 1 });
});
afterEach(() => { mockGet.mockReset(); mockAll.mockReset(); mockRun.mockReset(); jest.clearAllMocks(); });

// ── Setting guard ─────────────────────────────────────────────────────────────

describe('reminders_enabled setting', () => {
  test('does nothing when setting is explicitly disabled', async () => {
    mockGet.mockReturnValueOnce({ key: 'reminders_enabled', value: 'false' });
    const db = require('../../db');
    await sendReminders(makeClient());
    // Only the settings .get() should have been called; no .all() for clubBooks
    expect(mockAll).not.toHaveBeenCalled();
  });

  test('proceeds when setting is enabled', async () => {
    mockGet.mockReturnValueOnce({ key: 'reminders_enabled', value: 'true' });
    mockAll
      .mockReturnValueOnce([CLUB_BOOK]) // clubBooks
      .mockReturnValueOnce([])          // readingLogs → no stale logs
      .mockReturnValueOnce([]);         // reminderQuips (not reached, but safe)
    await sendReminders(makeClient());
    expect(mockAll).toHaveBeenCalled();
  });

  test('proceeds when setting row does not exist (default enabled)', async () => {
    mockGet.mockReturnValueOnce(undefined); // no setting row
    mockAll
      .mockReturnValueOnce([CLUB_BOOK])
      .mockReturnValueOnce([]);
    await sendReminders(makeClient());
    expect(mockAll).toHaveBeenCalled();
  });
});

// ── No BOTM this month ────────────────────────────────────────────────────────

describe('no BOTM this month', () => {
  test('does nothing when no club books match the current month', async () => {
    mockGet.mockReturnValueOnce(undefined); // setting (enabled)
    mockAll.mockReturnValueOnce([]);        // clubBooks → empty
    await sendReminders(makeClient());
    // mockAll called once for clubBooks, then should stop
    expect(mockAll).toHaveBeenCalledTimes(1);
  });
});

// ── No stale logs ─────────────────────────────────────────────────────────────

describe('no stale logs', () => {
  test('does nothing when no reading logs are overdue', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK]) // clubBooks
      .mockReturnValueOnce([]);          // readingLogs → empty (no stale)
    await sendReminders(makeClient());
    // 2 .all() calls: clubBooks + readingLogs; no quips call since stale is empty
    expect(mockAll).toHaveBeenCalledTimes(2);
  });
});

// ── No quips ──────────────────────────────────────────────────────────────────

describe('no quips in db', () => {
  test('does nothing when quip table is empty', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK])  // clubBooks
      .mockReturnValueOnce([STALE_LOG])  // readingLogs
      .mockReturnValueOnce([]);          // reminderQuips → empty
    const client = makeClient();
    await sendReminders(client);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('happy path', () => {
  test('sends a quip to the stale log thread', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK]) // clubBooks
      .mockReturnValueOnce([STALE_LOG]) // readingLogs
      .mockReturnValueOnce([QUIP]);     // reminderQuips
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(threadSend);

    await sendReminders(client);

    expect(client.channels.fetch).toHaveBeenCalledWith('thread-1');
    expect(threadSend).toHaveBeenCalledWith(expect.stringContaining('<@user-1>'));
    expect(threadSend).toHaveBeenCalledWith(expect.stringContaining('Read your book!'));
  });

  test('updates lastRemindedAt on the log after sending', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK])
      .mockReturnValueOnce([STALE_LOG])
      .mockReturnValueOnce([QUIP]);
    const db = require('../../db');
    const client = makeClient();

    await sendReminders(client);

    expect(db.update).toHaveBeenCalled();
  });

  test('sends reminders across multiple BOTM books in the same month', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([{ bookId: 1 }, { bookId: 2 }]) // clubBooks
      .mockReturnValueOnce([                                 // readingLogs
        { ...STALE_LOG, id: 10, bookId: 1, threadId: 'thread-1' },
        { ...STALE_LOG, id: 11, bookId: 2, threadId: 'thread-2' },
      ])
      .mockReturnValueOnce([QUIP]);
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send: threadSend }) } };

    await sendReminders(client);

    expect(threadSend).toHaveBeenCalledTimes(2);
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('resilience', () => {
  test('skips logs with no threadId', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK])
      .mockReturnValueOnce([{ ...STALE_LOG, threadId: null }])
      .mockReturnValueOnce([QUIP]);
    const client = makeClient();

    await sendReminders(client);

    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  test('skips a log when thread fetch fails, continues with others', async () => {
    mockGet.mockReturnValueOnce(undefined);
    mockAll
      .mockReturnValueOnce([CLUB_BOOK])
      .mockReturnValueOnce([
        { ...STALE_LOG, id: 10, threadId: 'thread-bad' },
        { ...STALE_LOG, id: 11, threadId: 'thread-good' },
      ])
      .mockReturnValueOnce([QUIP]);
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: jest.fn()
          .mockRejectedValueOnce(new Error('Unknown Channel'))
          .mockResolvedValue({ send: threadSend }),
      },
    };

    await sendReminders(client);

    expect(threadSend).toHaveBeenCalledTimes(1);
  });
});
