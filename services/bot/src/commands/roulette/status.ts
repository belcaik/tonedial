import {
  EmbedBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandStringOption,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { fetchRouletteSession } from '../../lib/api-client.js';
import { clearActiveSession, getActiveSession } from '../../lib/roulette-state.js';
import { debugLog } from '../../lib/debug.js';

const sessionOption = new SlashCommandStringOption()
  .setName('session_id')
  .setDescription('Session identifier to inspect')
  .setRequired(false);

export const statusSubcommand = new SlashCommandSubcommandBuilder()
  .setName('status')
  .setDescription('Display the current roulette session status for this guild.')
  .addStringOption(sessionOption);

export async function handleStatus(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    return;
  }

  const providedId = interaction.options.getString('session_id') ?? undefined;
  const sessionId = providedId ?? getActiveSession(guildId);

  if (!sessionId) {
    await interaction.reply({ content: 'No active roulette session found.', ephemeral: true });
    return;
  }

  try {
    const snapshot = await fetchRouletteSession(sessionId);
    debugLog('Fetched roulette status', snapshot);
    const embed = new EmbedBuilder()
      .setTitle('Roulette status')
      .addFields(
        { name: 'Session ID', value: snapshot.sessionId },
        { name: 'Deadline', value: new Date(snapshot.deadline).toLocaleTimeString() },
        { name: 'Candidates', value: `${snapshot.pool.length}`, inline: true },
        { name: 'Max proposals', value: `${snapshot.rules.maxProposals}`, inline: true },
      )
      .setColor(0x00cec9);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    clearActiveSession(guildId);
    debugLog('Roulette status failed', error);
    await interaction.reply({ content: (error as Error).message, ephemeral: true });
  }
}
