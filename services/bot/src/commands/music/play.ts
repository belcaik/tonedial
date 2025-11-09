import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getMusic } from '../../music.js';

export const command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Load and play a song via Lavalink.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('URL or search query to play')
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const music = getMusic();
    const query = interaction.options.getString('query', true);

    try {
      const channel = await music.ensureVoice(interaction);
      await music.join(channel, interaction.guildId);
      const track = await music.loadTrack(query);
      const result = await music.play(interaction.guildId, track);
      const description = track.info.uri ? `[${track.info.title}](${track.info.uri})` : track.info.title;
      if (result.status === 'queued') {
        await interaction.reply(`Queued ${description}. Position in queue: ${result.position}.`);
      } else {
        await interaction.reply(`Playing ${description}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to play that track.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
