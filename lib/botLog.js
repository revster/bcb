/**
 * lib/botLog.js
 *
 * Posts a message to the #bot-log channel if it exists in the guild.
 * Silently no-ops if the channel is missing or the send fails.
 */

const BOT_LOG_CHANNEL_NAME = 'bot-log';

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} message
 */
async function botLog(guild, message) {
  try {
    const channel = guild.channels.cache.find(c => c.name === BOT_LOG_CHANNEL_NAME);
    if (!channel) return;
    const now = new Date();
    const timestamp = now.toUTCString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
    await channel.send(`\`[${timestamp} UTC]\` ${message}`);
  } catch {
    // Never let logging break a command
  }
}

module.exports = { botLog };
