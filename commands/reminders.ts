/**
 * commands/reminders.ts — /reminders
 *
 * Admin command to enable, disable, or check the status of weekly reading
 * reminders. Requires Manage Guild permission.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import db = require('../db');
import { settings } from '../schema';

export const data = new SlashCommandBuilder()
  .setName('reminders')
  .setDescription('Manage weekly reading reminders (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('enable').setDescription('Enable weekly reading reminders')
  )
  .addSubcommand(sub =>
    sub.setName('disable').setDescription('Disable weekly reading reminders')
  )
  .addSubcommand(sub =>
    sub.setName('status').setDescription('Check whether reminders are currently enabled')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'enable' || sub === 'disable') {
    const value = sub === 'enable' ? 'true' : 'false';
    db.insert(settings)
      .values({ key: 'reminders_enabled', value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    const msg = sub === 'enable'
      ? 'Weekly reading reminders are now **enabled**.'
      : 'Weekly reading reminders are now **disabled**.';
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } else {
    const setting = db.select().from(settings).where(eq(settings.key, 'reminders_enabled')).get();
    const enabled = setting?.value !== 'false';
    await interaction.reply({
      content: `Weekly reading reminders are currently **${enabled ? 'enabled' : 'disabled'}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
