import { EmbedBuilder, SlashCommandSubcommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { isDebugEnabled } from '../../lib/debug.js';

const DEFAULT_BASE_WEIGHT = Number(process.env.ROULETTE_BASE_WEIGHT ?? 1);
const DEFAULT_VOTE_WEIGHT = Number(process.env.ROULETTE_VOTE_WEIGHT ?? 0.25);
const DEFAULT_WINDOW = Number(process.env.ROULETTE_DEFAULT_WINDOW ?? 60);

export const settingsSubcommand = new SlashCommandSubcommandBuilder()
  .setName('settings')
  .setDescription('View roulette defaults for this guild.');

export async function handleSettings(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('Roulette defaults')
    .addFields(
      { name: 'Vote window (s)', value: `${DEFAULT_WINDOW}`, inline: true },
      { name: 'Base weight', value: DEFAULT_BASE_WEIGHT.toFixed(2), inline: true },
      { name: 'Vote weight %', value: `${(DEFAULT_VOTE_WEIGHT * 100).toFixed(0)}%`, inline: true },
    )
    .setColor(0xa29bfe)
    .setFooter({ text: 'Per-guild overrides coming soon.' });

  const footer = isDebugEnabled() ? 'Debug logging enabled via ROULETTE_DEBUG' : 'Per-guild overrides coming soon.';
  embed.setFooter({ text: footer });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
