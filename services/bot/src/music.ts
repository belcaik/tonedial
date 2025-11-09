import {
  Client,
  GatewayDispatchEvents,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import { Node, type NodeOptions, type Player } from 'lavaclient';

const DEFAULT_LAVALINK_HOST = 'lavalink';
const DEFAULT_LAVALINK_PORT = 2333;
const DEFAULT_LAVALINK_PASSWORD = 'youshallnotpass';

type LoadedTrack = {
  encoded: string;
  info: {
    title: string;
    uri: string | null;
    author: string;
  };
};

type QueueEntry = LoadedTrack;

type PlayResult =
  | {
      status: 'playing';
    }
  | {
      status: 'queued';
      position: number;
    };

type PlayerEventName = Parameters<Player<Node>['on']>[0];
type PlayerEventListener = Parameters<Player<Node>['on']>[1];
const PLAYER_EVENT_NAME = 'event' as PlayerEventName;

export class MusicManager {
  private readonly node: Node;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private readonly reconnectDelayMs = 5_000;
  private hasActiveSession = false;
  private currentSessionId: string | null = null;
  private readonly queues = new Map<string, QueueEntry[]>();
  private readonly nowPlaying = new Map<string, QueueEntry>();
  private readonly playerListeners = new Map<string, PlayerEventListener>();

  constructor(private readonly client: Client) {
    const host = process.env.LAVALINK_HOST ?? DEFAULT_LAVALINK_HOST;
    const port = Number(process.env.LAVALINK_PORT ?? DEFAULT_LAVALINK_PORT);
    const password = process.env.LAVALINK_PASSWORD ?? DEFAULT_LAVALINK_PASSWORD;

    const discordOptions: NodeOptions['discord'] = {
      sendGatewayCommand: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          return;
        }
        guild.shard?.send(payload);
      },
    };

    if (client.user?.id) {
      discordOptions.userId = client.user.id;
    }

    const infoOptions: NonNullable<NodeOptions['info']> = {
      host,
      port,
      auth: password,
    };

    const wsOptions: NonNullable<NodeOptions['ws']> = {
      clientName: 'ToneDial (lavaclient)',
    };

    this.node = new Node({
      info: infoOptions,
      discord: discordOptions,
      ws: wsOptions,
    });


    this.node.on('connected', () => {
      console.info('Connected to Lavalink');
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
    });

    this.node.on('ready', (event: any) => {
      const sessionId = (event as { sessionId?: string | null } | undefined)?.sessionId ?? null;
      this.hasActiveSession = true;
      this.currentSessionId = sessionId;
      console.info(
        sessionId ? `Lavalink session ready (${sessionId})` : 'Lavalink session ready (no session id)',
      );
    });

    this.node.on('disconnected', () => {
      console.warn('Disconnected from Lavalink');
      this.connectPromise = null;
      this.hasActiveSession = false;
      this.currentSessionId = null;
      this.queues.clear();
      this.nowPlaying.clear();
      this.scheduleReconnect();
    });

    this.node.on('error', (error) => {
      console.error('Lavalink error', error);
      if (!this.hasActiveSession) {
        this.scheduleReconnect();
      }
    });

    client.ws.on(GatewayDispatchEvents.VoiceServerUpdate, (data) => {
      void this.node.players.handleVoiceUpdate(data);
    });

    client.ws.on(GatewayDispatchEvents.VoiceStateUpdate, (data) => {
      if (data.user_id !== this.client.user?.id) {
        return;
      }
      void this.node.players.handleVoiceUpdate(data);
    });
  }

  async connect() {
    if (!this.client.user) {
      throw new Error('Discord client is not ready yet, cannot connect to Lavalink');
    }

    if (this.hasActiveSession) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    console.info('Connecting to Lavalink...');

    const promise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.node.off('ready', onReady);
        this.node.off('error', onError);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for Lavalink session.'));
      }, 15_000);

      const onReady = (_event: any) => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        cleanup();
        reject(error);
      };

      this.node.once('ready', onReady);
      this.node.once('error', onError);

      try {
        const user = this.client.user;
        if (!user) {
          throw new Error('Discord client is not ready yet, cannot connect to Lavalink');
        }
        this.node.connect({ userId: user.id });
      } catch (error) {
        onError(error as Error);
      }
    })
      .finally(() => {
        if (this.connectPromise === promise) {
          this.connectPromise = null;
        }
      });

    this.connectPromise = promise;

    try {
      await promise;
    } catch (error) {
      this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout || !this.client.user) {
      return;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      void this.connect().catch((error) => {
        console.error('Failed to reconnect to Lavalink', error);
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
  }

  private async ensureNodeReady() {
    if (!this.hasActiveSession) {
      await this.connect();
    }

    if (!this.hasActiveSession) {
      throw new Error('Music backend is still connecting, please try again.');
    }
  }

  getPlayer(guildId: string) {
    if (!this.hasActiveSession) {
      throw new Error('Lavalink session unavailable yet. Please try again in a moment.');
    }
    return this.node.players.resolve(guildId) ?? this.node.players.create(guildId);
  }

  async destroyPlayer(guildId: string) {
    const player = this.node.players.resolve(guildId);
    if (!player) {
      return false;
    }

    player.voice.disconnect();
    this.detachPlayerListener(guildId, player);
    this.queues.delete(guildId);
    this.nowPlaying.delete(guildId);
    await this.node.players.destroy(guildId);
    return true;
  }

  async ensureVoice(interaction: ChatInputCommandInteraction): Promise<VoiceBasedChannel> {
    if (!interaction.guildId || !interaction.guild) {
      throw new Error('This command can only run inside a guild.');
    }

    const member = await this.resolveMember(interaction);
    const channel = member.voice.channel;

    if (!channel) {
      throw new Error('You need to be in a voice channel first.');
    }

    if (!channel.joinable) {
      throw new Error('I cannot join that voice channel. Check my permissions.');
    }

    return channel;
  }

  async join(channel: VoiceBasedChannel, guildId: string) {
    await this.ensureNodeReady();
    const player = this.getPlayer(guildId);
    player.voice.connect(channel.id, { deafened: true });
    return player;
  }

  async loadTrack(query: string): Promise<LoadedTrack> {
    const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;
    const result = await this.node.api.loadTracks(identifier);

    if (result.loadType === 'error') {
      throw new Error(result.data.message ?? 'Lavalink returned an error while loading the track.');
    }

    if (result.loadType === 'empty') {
      throw new Error('No tracks were found for that query.');
    }

    if (result.loadType === 'track') {
      return result.data;
    }

    if (result.loadType === 'playlist') {
      const [firstTrack] = result.data.tracks;
      if (!firstTrack) {
        throw new Error('The playlist did not include any playable tracks.');
      }
      return firstTrack;
    }

    if (result.loadType === 'search') {
      const track = result.data[0];
      if (!track) {
        throw new Error('No tracks were found for that query.');
      }
      return track;
    }

    throw new Error('Unexpected Lavalink response.');
  }

  async play(guildId: string, track: LoadedTrack): Promise<PlayResult> {
    await this.ensureNodeReady();

    const existingPlayer = this.node.players.resolve(guildId) as
      | {
          [key: string]: unknown;
          state?: { [key: string]: unknown };
        }
      | undefined;
    const hint = existingPlayer?.track ?? existingPlayer?.state?.track ?? existingPlayer?.current;
    const hasActiveTrack = this.nowPlaying.has(guildId) || Boolean(hint);

    if (!hasActiveTrack) {
      await this.startTrack(guildId, track);
      console.info(`Playing track: ${track.info.title}`);
      return { status: 'playing' };
    }

    const queue = this.queues.get(guildId) ?? [];
    queue.push(track);
    this.queues.set(guildId, queue);
    console.info(`Queued track (${queue.length}) in guild ${guildId}: ${track.info.title}`);
    return { status: 'queued', position: queue.length };
  }

  async stop(guildId: string) {
    const player = this.node.players.resolve(guildId);
    if (!player) {
      throw new Error('There is no active player in this guild.');
    }

    this.queues.delete(guildId);
    this.nowPlaying.delete(guildId);
    await player.stop();
  }

  async skip(guildId: string) {
    const player = this.node.players.resolve(guildId);
    const current = this.nowPlaying.get(guildId);

    if (!player || !current) {
      throw new Error('There is no track playing right now.');
    }

    this.nowPlaying.delete(guildId);
    await player.stop();
    await this.playNextFromQueue(guildId);
    return current;
  }

  getNextInQueue(guildId: string) {
    const queue = this.queues.get(guildId);
    if (!queue || queue.length === 0) {
      return null;
    }
    return queue[0];
  }

  getNowPlaying(guildId: string) {
    return this.nowPlaying.get(guildId) ?? null;
  }

  private async startTrack(guildId: string, track: QueueEntry) {
    await this.ensureNodeReady();
    const player = this.getPlayer(guildId);
    this.attachPlayerListener(player, guildId);
    await player.play(track.encoded);
    this.nowPlaying.set(guildId, track);
  }

  private attachPlayerListener(player: Player<Node>, guildId: string) {
    if (this.playerListeners.has(guildId)) {
      return;
    }

    const onEvent: PlayerEventListener = (event: unknown) => {
      void this.handlePlayerEvent(guildId, event);
    };

    player.on(PLAYER_EVENT_NAME, onEvent as never);
    this.playerListeners.set(guildId, onEvent);
  }

  private detachPlayerListener(guildId: string, player: Player<Node>) {
    const listener = this.playerListeners.get(guildId);
    if (!listener) {
      return;
    }

    this.playerListeners.delete(guildId);

    player.off?.(PLAYER_EVENT_NAME, listener as never);
  }

  private async handlePlayerEvent(guildId: string, event: unknown) {
    if (!event || typeof event !== 'object') {
      return;
    }

    const payload = event as { type?: string; reason?: string | null };

    if (payload.type === 'TrackEndEvent') {
      if (payload.reason === 'REPLACED') {
        return;
      }
      if (payload.reason === 'STOPPED' && !this.nowPlaying.has(guildId)) {
        return;
      }
      this.nowPlaying.delete(guildId);
      await this.playNextFromQueue(guildId);
      return;
    }

    if (payload.type === 'TrackExceptionEvent' || payload.type === 'TrackStuckEvent') {
      this.nowPlaying.delete(guildId);
      await this.playNextFromQueue(guildId);
    }
  }

  private async playNextFromQueue(guildId: string) {
    const queue = this.queues.get(guildId);
    if (!queue || queue.length === 0) {
      this.queues.delete(guildId);
      return;
    }

    const next = queue.shift();
    if (!queue.length) {
      this.queues.delete(guildId);
    } else {
      this.queues.set(guildId, queue);
    }

    if (!next) {
      return;
    }

    try {
      await this.startTrack(guildId, next);
      console.info(`Auto-playing queued track in guild ${guildId}: ${next.info.title}`);
    } catch (error) {
      console.error('Failed to play queued track', error);
      await this.playNextFromQueue(guildId);
    }
  }

  private async resolveMember(interaction: ChatInputCommandInteraction): Promise<GuildMember> {
    if (!interaction.guild) {
      throw new Error('Guild not available.');
    }

    const cached = interaction.guild.members.cache.get(interaction.user.id);
    if (cached) {
      return cached;
    }

    return interaction.guild.members.fetch(interaction.user.id);
  }
}

let musicManager: MusicManager | null = null;

export const initMusic = (client: Client) => {
  musicManager = new MusicManager(client);
  return musicManager;
};

export const getMusic = () => {
  if (!musicManager) {
    throw new Error('Music manager has not been initialized.');
  }

  return musicManager;
};
