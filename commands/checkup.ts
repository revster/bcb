/**
 * commands/checkup.ts — /checkup
 *
 * Admin diagnostic. For every registered member, verifies:
 *   1. Their forum channel still exists in the guild
 *   2. The channel has a "Bot" tag
 *   3. The channel has a "Book of the Month" tag
 *   4. The channel has a "Completed" tag
 *   5. The channel has an "Abandoned" tag
 *
 * Replies ephemerally with a summary. Members are never tagged.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, ForumChannel } from 'discord.js';
import db = require('../db');
import { memberChannels } from '../schema';

const REQUIRED_TAGS = ['Bot', 'Book of the Month', 'Completed', 'Abandoned'];

export const data = new SlashCommandBuilder()
  .setName('checkup')
  .setDescription('Check that all registered members have valid channels and required tags')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const members = db.select().from(memberChannels).all();

  if (!members.length) {
    await interaction.editReply('No registered members found.');
    return;
  }

  const issues: string[] = [];

  await Promise.all(members.map(async mc => {
    const channel = await interaction.guild!.channels.fetch(mc.channelId).catch(() => null);

    if (!channel) {
      issues.push(`**${mc.username}** — channel not found`);
      return;
    }

    const forumChannel = channel as ForumChannel;
    const missingTags = REQUIRED_TAGS.filter(
      name => !forumChannel.availableTags?.some(t => t.name === name)
    );

    if (missingTags.length > 0) {
      issues.push(`**${mc.username}** — missing tags: ${missingTags.join(', ')}`);
    }
  }));

  if (!issues.length) {
    await interaction.editReply(`✅ All ${members.length} registered members are healthy.`);
    return;
  }

  const lines = [
    `⚠️ Issues found (${issues.length}/${members.length} members):`,
    ...issues,
  ];

  await interaction.editReply(lines.join('\n'));
}
