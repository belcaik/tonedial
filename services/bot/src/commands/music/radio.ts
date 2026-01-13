import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import * as apiClient from '../../lib/api-client.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Smart radio controls')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('Enable radio mode')
        .addStringOption((option) =>
          option
            .setName('algorithm')
            .setDescription('Recommendation algorithm')
            .addChoices(
              { name: 'Similarity (match energy & vibe)', value: 'similarity' },
              { name: 'Genre (stay within genres)', value: 'genre' },
              { name: 'Mixed (balanced discovery)', value: 'mixed' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('stop').setDescription('Disable radio mode'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Show radio status and settings'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    try {
      await interaction.deferReply();

      switch (subcommand) {
        case 'start':
          await handleStart(interaction, guildId);
          break;
        case 'stop':
          await handleStop(interaction, guildId);
          break;
        case 'status':
          await handleStatus(interaction, guildId);
          break;
        default:
          await interaction.editReply('Unknown subcommand');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `Error: ${message}` });
      } else {
        await interaction.reply({ content: `Error: ${message}`, ephemeral: true });
      }
    }
  },
};

async function handleStart(interaction: ChatInputCommandInteraction, guildId: string) {
  const algorithm =
    (interaction.options.getString('algorithm') as apiClient.RadioSettings['algorithm']) ??
    'similarity';

  await apiClient.startRadio(guildId, algorithm);

  const algorithmName = {
    similarity: 'Similarity',
    genre: 'Genre',
    mixed: 'Mixed',
  }[algorithm];

  await interaction.editReply(
    `🎵 **Radio enabled!**\n\n` +
      `**Algorithm:** ${algorithmName}\n` +
      `**How it works:** When your queue is empty, I'll automatically play similar songs based on your listening history.\n\n` +
      `Play some songs to help me learn your taste!`,
  );
}

async function handleStop(interaction: ChatInputCommandInteraction, guildId: string) {
  await apiClient.stopRadio(guildId);

  await interaction.editReply('🛑 **Radio disabled.**\n\nI will no longer auto-play songs when the queue is empty.');
}

async function handleStatus(interaction: ChatInputCommandInteraction, guildId: string) {
  const { settings } = await apiClient.getRadioSettings(guildId);
  const history = await apiClient.getPlaybackHistory(guildId, settings.historyLookbackHours);

  const statusEmoji = settings.enabled ? '✅' : '❌';
  const algorithmName = {
    similarity: 'Similarity (matches energy & vibe)',
    genre: 'Genre (stays within genres)',
    mixed: 'Mixed (balanced discovery)',
  }[settings.algorithm];

  let statusMessage =
    `📻 **Radio Status**\n\n` +
    `**Enabled:** ${statusEmoji}\n` +
    `**Algorithm:** ${algorithmName}\n` +
    `**Tracks in history:** ${history.count}\n\n`;

  if (settings.enabled) {
    statusMessage +=
      `**Settings:**\n` +
      `• Similarity threshold: ${Math.round(settings.similarityThreshold * 100)}%\n` +
      `• Genre diversity: ${Math.round(settings.genreDiversity * 100)}%\n` +
      `• Avoid repeats: ${settings.avoidRepeatHours} hours\n` +
      `• Queue size: ${settings.minQueueSize}-${settings.maxQueueSize} tracks\n\n`;

    if (history.count === 0) {
      statusMessage += `\n💡 **Tip:** Play a few songs to help me learn your taste!`;
    } else {
      statusMessage += `\n✨ Ready to recommend! When your queue is empty, I'll keep the music going.`;
    }
  } else {
    statusMessage += `\nUse \`/radio start\` to enable smart recommendations.`;
  }

  await interaction.editReply(statusMessage);
}
