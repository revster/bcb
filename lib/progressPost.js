/**
 * lib/progressPost.js
 *
 * Shared helper for building and maintaining the #progress channel post
 * for club books. One message per club book; updated whenever a member
 * logs progress, starts the book, or finishes it.
 */

const db = require('../db');

const PROGRESS_CHANNEL_NAME = 'progress';
const BAR_LENGTH = 20;

function buildBar(pct) {
  const filled = Math.round((Math.min(pct, 100) / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

/**
 * Rebuilds and edits (or creates) the #progress post for the given bookId.
 * No-ops silently if the book is not a ClubBook or if #progress doesn't exist.
 *
 * @param {number} bookId
 * @param {import('discord.js').Guild} guild
 */
async function updateProgressPost(bookId, guild) {
  const clubBook = await db.clubBook.findUnique({
    where: { bookId },
    include: { book: true },
  });
  if (!clubBook) return;

  const logs = await db.readingLog.findMany({
    where: { bookId },
    orderBy: { startedAt: 'asc' },
  });
  if (logs.length === 0) return;

  // Build userId → username map from MemberChannel records
  const memberChannels = await db.memberChannel.findMany({
    where: { userId: { in: logs.map(l => l.userId) } },
  });
  const usernameMap = Object.fromEntries(memberChannels.map(mc => [mc.userId, mc.username]));

  const lines = logs.map(log => {
    const pct = log.status === 'finished' ? 100 : log.progress;
    const bar = buildBar(pct);
    const pctStr = pct.toFixed(0).padStart(3) + '%';
    const tag = log.status === 'finished' ? ' ✓' : '';
    const name = usernameMap[log.userId] || `<@${log.userId}>`;
    return `**${name}** ${bar} ${pctStr}${tag}`;
  });

  const { book } = clubBook;
  const content = [`**${book.title}** by ${book.author}`, `<${book.goodreadsUrl}>`, '', ...lines].join('\n');

  const progressChannel = guild.channels.cache.find(c => c.name === PROGRESS_CHANNEL_NAME);
  if (!progressChannel) return;

  if (clubBook.progressMessageId) {
    try {
      const msg = await progressChannel.messages.fetch(clubBook.progressMessageId);
      await msg.edit(content);
      return;
    } catch {
      // Message was deleted — fall through to create a new one
    }
  }

  const msg = await progressChannel.send(content);
  await db.clubBook.update({
    where: { bookId },
    data: { progressMessageId: msg.id },
  });
}

module.exports = { updateProgressPost };
