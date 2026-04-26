import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { polls } from '../schema';
import { botLog } from '../lib/botLog';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const data = new SlashCommandBuilder()
  .setName('vote-end')
  .setDescription('Close the currently open voting period')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const poll = db.select().from(polls).where(eq(polls.open, true)).get();

  if (!poll) {
    await interaction.reply({ content: 'No poll is currently open.', flags: MessageFlags.Ephemeral });
    return;
  }

  db.update(polls).set({ open: false }).where(eq(polls.id, poll.id)).run();

  const label = `${MONTH_NAMES[poll.month - 1]} ${poll.year}`;
  await botLog(interaction.guild!, `Voting closed for ${label} by ${interaction.user.username}`);
  await interaction.reply({ content: `Voting for **${label}** is now closed.`, flags: MessageFlags.Ephemeral });
}
