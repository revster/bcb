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
    const timestamp = new Date().toISOString().slice(11, 19);
    await channel.send(`\`[${timestamp} UTC]\` ${message}`);
  } catch {
    // Never let logging break a command
  }
}

module.exports = { botLog };
