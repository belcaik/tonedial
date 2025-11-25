import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandIntegerOption,
  SlashCommandNumberOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  ChannelType,
} from 'discord.js';
import type { OwnershipMode, PoolMode } from '@tonedial/shared';
import { createRouletteSession, requestActivityToken } from '../../lib/api-client.js';
import { setActiveSession } from '../../lib/roulette-state.js';
import { debugLog } from '../../lib/debug.js';

const DEFAULT_BASE_WEIGHT = Number(process.env.ROULETTE_BASE_WEIGHT ?? 1);
const DEFAULT_VOTE_WEIGHT = Number(process.env.ROULETTE_VOTE_WEIGHT ?? 0.25);
const ACTIVITY_BASE_URL =
  process.env.ACTIVITY_PUBLIC_URL ??
  process.env.ACTIVITY_URL ??
  process.env.PUBLIC_ORIGIN ??
  'http://localhost:5173';
const ACTIVITY_API_BASE =
  process.env.API_PUBLIC_BASE_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.PUBLIC_API_URL ??
  process.env.API_ORIGIN ??
  process.env.PUBLIC_ORIGIN ??
  'http://localhost:8080';
const DISCORD_APP_ID = process.env.DISCORD_APP_ID ?? process.env.VITE_DISCORD_CLIENT_ID;

const maxProposalsOption = new SlashCommandIntegerOption()
  .setName('max_proposals')
  .setDescription('Maximum number of secret proposals each user can submit')
  .setMinValue(1)
  .setMaxValue(10)
  .setRequired(true);

const timeOption = new SlashCommandIntegerOption()
  .setName('time_sec')
  .setDescription('Voting window in seconds')
  .setMinValue(10)
  .setMaxValue(600)
  .setRequired(true);

const ownershipOption = new SlashCommandStringOption()
  .setName('ownership')
  .setDescription('Ownership mode')
  .addChoices(
    { name: 'All participants own the game', value: 'all' },
    { name: 'Threshold percentage', value: 'threshold' },
  )
  .setRequired(true);

const poolOption = new SlashCommandStringOption()
  .setName('pool')
  .setDescription('Pool creation mode')
  .addChoices(
    { name: 'Intersection (everyone owns)', value: 'intersection' },
    { name: 'Union (any participant owns)', value: 'union' },
  )
  .setRequired(true);

const minPlayersOption = new SlashCommandIntegerOption()
  .setName('min_players')
  .setDescription('Minimum player count requirement for a game')
  .setMinValue(1)
  .setMaxValue(16)
  .setRequired(false);

const ownershipThresholdOption = new SlashCommandNumberOption()
  .setName('ownership_threshold_pct')
  .setDescription('Threshold between 0.1 and 1 for threshold ownership mode')
  .setMinValue(0.1)
  .setMaxValue(1)
  .setRequired(false);

export const startSubcommand = new SlashCommandSubcommandBuilder()
  .setName('start')
  .setDescription('Start a roulette session for the current voice channel')
  .addIntegerOption(maxProposalsOption)
  .addIntegerOption(timeOption)
  .addStringOption(ownershipOption)
  .addStringOption(poolOption)
  .addIntegerOption(minPlayersOption)
  .addNumberOption(ownershipThresholdOption);

export async function handleStart(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command only works inside servers.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: 'Join a voice channel first so I can detect participants.',
      ephemeral: true,
    });
    return;
  }

  const humanMembers = voiceChannel.members.filter((voiceMember) => !voiceMember.user.bot);
  debugLog('Detected voice members', {
    guildId,
    voiceChannelId: voiceChannel.id,
    totalMembers: voiceChannel.members.size,
    humanMembers: humanMembers.size,
  });
  if (humanMembers.size === 0) {
    await interaction.reply({ content: 'Need at least one human participant in voice.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const ownershipMode = interaction.options.getString('ownership', true) as OwnershipMode;
  const poolMode = interaction.options.getString('pool', true) as PoolMode;
  const thresholdOverride = interaction.options.getNumber('ownership_threshold_pct') ?? undefined;
  const ownershipThreshold =
    ownershipMode === 'threshold' ? thresholdOverride ?? 0.75 : undefined;

  const payload = {
    rules: {
      guildId,
      textChannelId: interaction.channelId,
      voiceChannelId: voiceChannel.id,
      createdBy: interaction.user.id,
      maxProposals: interaction.options.getInteger('max_proposals', true),
      timeSeconds: interaction.options.getInteger('time_sec', true),
      ownershipMode,
      poolMode,
      minPlayers: interaction.options.getInteger('min_players') ?? undefined,
      ownershipThresholdPct: ownershipThreshold,
      baseWeight: DEFAULT_BASE_WEIGHT,
      voteWeightPct: DEFAULT_VOTE_WEIGHT,
    },
    participants: Array.from(humanMembers.values()).map((voiceMember) => ({
      userId: voiceMember.id,
      displayName: voiceMember.displayName,
    })),
  };
  debugLog('Prepared roulette payload', payload);

  try {
    const session = await createRouletteSession(payload);

    let activityToken = session.token;
    let expiresAt = session.expiresAt ?? null;

    try {
      const tokenResponse = await requestActivityToken(session.sessionId, interaction.user.id);
      activityToken = tokenResponse.token;
      expiresAt = tokenResponse.exp ? new Date(tokenResponse.exp * 1000).toISOString() : expiresAt;
    } catch (tokenError) {
      debugLog('Falling back to session token returned by /roulette/session', tokenError);
    }

    setActiveSession(guildId, session.sessionId, expiresAt ?? undefined);
    debugLog('Roulette session created', { sessionId: session.sessionId, expiresAt });

    const activityUrl = new URL(ACTIVITY_BASE_URL);
    activityUrl.searchParams.set('sid', session.sessionId);
    activityUrl.searchParams.set('token', activityToken);
    activityUrl.searchParams.set('api', ACTIVITY_API_BASE);
    if (DISCORD_APP_ID) {
      activityUrl.searchParams.set('cid', DISCORD_APP_ID);
    }

    const embed = new EmbedBuilder()
      .setTitle('Roulette session started')
      .setDescription(`Voice channel: <#${voiceChannel.id}> | Time: ${payload.rules.timeSeconds}s`)
      .addFields(
        { name: 'Participants', value: `${humanMembers.size} users`, inline: true },
        { name: 'Max proposals', value: `${payload.rules.maxProposals}`, inline: true },
        { name: 'Ownership', value: payload.rules.ownershipMode, inline: true },
      )
      .setColor(0x6c5ce7)
      .setFooter({
        text: expiresAt ? `Session ID ${session.sessionId} · token exp ${expiresAt}` : `Session ID ${session.sessionId}`,
      });

    const button = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Abrir Activity (fallback web)')
      .setURL(activityUrl.toString());

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    debugLog('Roulette start failed', error);
    await interaction.editReply({ content: (error as Error).message });
  }
}
