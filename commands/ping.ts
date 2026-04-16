import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { botLog } from '../lib/botLog';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if the bot is alive');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply('Pong! 🏓');
  await botLog(interaction.guild!, `[ping] ${interaction.user.username} checked bot health`);
}
