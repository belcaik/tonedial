import {
  EmbedBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandStringOption,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { closeRoulette } from '../../lib/api-client.js';
import { getActiveSession } from '../../lib/roulette-state.js';
import { debugLog } from '../../lib/debug.js';

const sessionOption = new SlashCommandStringOption()
  .setName('session_id')
  .setDescription('Session identifier to reroll')
  .setRequired(false);

export const rerollSubcommand = new SlashCommandSubcommandBuilder()
  .setName('reroll')
  .setDescription('Re-roll the roulette session using the same candidates.')
  .addStringOption(sessionOption);

export async function handleReroll(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
    return;
  }

  const sessionId = interaction.options.getString('session_id') ?? getActiveSession(guildId);
  if (!sessionId) {
    await interaction.reply({ content: 'No session to reroll.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await closeRoulette({ sessionId, requestedBy: interaction.user.id, action: 'reroll' });
    debugLog('Roulette reroll result', result);
    const embed = new EmbedBuilder()
      .setTitle('Roulette rerolled')
      .addFields(
        { name: 'Session ID', value: result.sessionId },
        { name: 'Winning AppID', value: `${result.appId}` },
      )
      .setColor(0xfdcb6e)
      .setFooter({ text: 'Weights preserved from previous close' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    debugLog('Roulette reroll failed', error);
    await interaction.editReply({ content: (error as Error).message });
  }
}
