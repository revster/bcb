/**
 * commands/unregister.ts — /unregister <user>
 *
 * Admin-only. Removes a member's forum channel registration so they are
 * excluded from future /read and /club-start thread creation.
 * Existing reading logs and threads are left untouched.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags } from 'discord.js';
import db = require('../db');
import { botLog } from '../lib/botLog';

export const data = new SlashCommandBuilder()
  .setName('unregister')
  .setDescription("Remove a member's reading channel registration")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o =>
    o.setName('user').setDescription('The member to unregister').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);

  const existing = await db.memberChannel.findUnique({ where: { userId: user.id } });

  if (!existing) {
    await interaction.reply({
      content: `<@${user.id}> is not registered.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await db.memberChannel.delete({ where: { userId: user.id } });

  await interaction.reply({
    content: `Unregistered <@${user.id}>. Their existing threads and reading logs are unchanged.`,
    flags: MessageFlags.Ephemeral,
  });
  await botLog(interaction.guild!, `[unregister] ${user.username} removed by ${interaction.user.username}`);
}
