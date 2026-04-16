/**
 * lib/botLog.ts
 *
 * Posts a message to the #bot-log channel if it exists in the guild.
 * Silently no-ops if the channel is missing or the send fails.
 */

import type { Guild } from 'discord.js';

const BOT_LOG_CHANNEL_NAME = 'bot-log';

export async function botLog(guild: Guild, message: string): Promise<void> {
  try {
    const channel = guild.channels.cache.find(c => c.name === BOT_LOG_CHANNEL_NAME);
    if (!channel || !('send' in channel)) return;
    const timestamp = new Date().toISOString().slice(11, 19);
    await channel.send(`\`[${timestamp} UTC]\` ${message}`);
  } catch {
    // Never let logging break a command
  }
}
