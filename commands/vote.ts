import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import type { ChatInputCommandInteraction, StringSelectMenuInteraction } from 'discord.js';
import db = require('../db');
import { polls, votes } from '../schema';
import { eq, and } from 'drizzle-orm';

// ── Hardcoded nominations ─────────────────────────────────────────────────────
// Temporary stand-in until the nomination system is built.
// TODO: replace this array with a DB query for Nomination rows tied to the active Poll.
// TODO: replace vote.first/second/third (string keys) with integer FK references to
//       Nomination.id (or Book.id) once nominations are stored in the database.
const NOMINATIONS = [
  { key: 'dune',                  title: 'Dune',                 author: 'Frank Herbert'   },
  { key: 'piranesi',              title: 'Piranesi',             author: 'Susanna Clarke'  },
  { key: 'anxious-people',        title: 'Anxious People',       author: 'Fredrik Backman' },
  { key: 'project-hail-mary',     title: 'Project Hail Mary',    author: 'Andy Weir'       },
  { key: 'the-midnight-library',  title: 'The Midnight Library', author: 'Matt Haig'       },
  { key: 'circe',                 title: 'Circe',                author: 'Madeline Miller' },
];

function bookTitle(key: string): string {
  return NOMINATIONS.find(b => b.key === key)?.title ?? key;
}

function buildRow(customId: string, excluded: string[], placeholder: string) {
  const options = NOMINATIONS
    .filter(b => !excluded.includes(b.key))
    .map(b =>
      new StringSelectMenuOptionBuilder()
        .setValue(b.key)
        .setLabel(b.title)
        .setDescription(b.author)
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(options)
  );
}

function getOpenPoll() {
  return db.select().from(polls).where(eq(polls.open, true)).get();
}

// ── Slash command ─────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('vote')
  .setDescription("Cast your top 3 votes for this month's book");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const poll = getOpenPoll();

  if (!poll) {
    await interaction.reply({ content: 'Voting is not open right now.', flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = db.select().from(votes)
    .where(and(eq(votes.pollId, poll.id), eq(votes.userId, interaction.user.id)))
    .get();

  const preamble = existing
    ? "**Update your vote for this month's book**\nPick your **1st choice**:"
    : "**Vote for this month's book**\nPick your **1st choice**:";

  await interaction.reply({
    content: preamble,
    components: [buildRow('vote:1', [], 'Your 1st choice')],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Select menu handler (called from index.ts) ────────────────────────────────

export async function handleVoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const step = parseInt(parts[1]);
  const selected = interaction.values[0];

  if (step === 1) {
    await interaction.update({
      content: `**Vote for this month's book**\n🥇 **1st:** ${bookTitle(selected)}\n\nNow pick your **2nd choice**:`,
      components: [buildRow(`vote:2:${selected}`, [selected], 'Your 2nd choice')],
    });

  } else if (step === 2) {
    const first = parts[2];
    await interaction.update({
      content: `**Vote for this month's book**\n🥇 **1st:** ${bookTitle(first)}\n🥈 **2nd:** ${bookTitle(selected)}\n\nNow pick your **3rd choice**:`,
      components: [buildRow(`vote:3:${first}:${selected}`, [first, selected], 'Your 3rd choice')],
    });

  } else if (step === 3) {
    const first = parts[2];
    const second = parts[3];
    const third = selected;

    const poll = getOpenPoll();
    if (!poll) {
      await interaction.update({ content: 'Voting has closed — your vote was not recorded.', components: [] });
      return;
    }

    db.insert(votes).values({
      pollId: poll.id,
      userId: interaction.user.id,
      first,
      second,
      third,
    }).onConflictDoUpdate({
      target: [votes.pollId, votes.userId],
      set: { first, second, third },
    }).run();

    await interaction.update({
      content: `**Your votes have been recorded!**\n\n🥇 ${bookTitle(first)}\n🥈 ${bookTitle(second)}\n🥉 ${bookTitle(third)}`,
      components: [],
    });
  }
}
