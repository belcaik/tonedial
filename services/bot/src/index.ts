import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
} from 'discord.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initMusic } from './music.js';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID_DEV;

if (!token) {
  throw new Error('DISCORD_TOKEN is not set. Add it to your environment before starting the bot.');
}

if (!appId || !guildId) {
  throw new Error('DISCORD_APP_ID and DISCORD_GUILD_ID_DEV must be configured to register slash commands.');
}

const resolvedAppId = appId;
const resolvedGuildId = guildId;

type SlashCommand = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const rest = new REST({ version: '10' }).setToken(token);
const commands = new Collection<string, SlashCommand>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  await loadCommandDirectory(commandsPath);
  return Array.from(commands.values()).map((command) => command.data.toJSON());
}

async function loadCommandDirectory(directory: string) {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await loadCommandDirectory(filePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const isTs = entry.name.endsWith('.ts');
    const isJs = entry.name.endsWith('.js');
    const isDts = entry.name.endsWith('.d.ts');

    if ((!isTs && !isJs) || isDts) {
      continue;
    }

    const module = await import(pathToFileURL(filePath).href);
    const command: SlashCommand | undefined = module.command;

    if (!command?.data || typeof command.execute !== 'function') {
      console.warn(`Skipping command at ${filePath} because it is missing a valid export.`);
      continue;
    }

    commands.set(command.data.name, command);
  }
}

async function registerGuildCommands(commandData: unknown[]) {
  console.info(`Registering ${commandData.length} guild command(s) for ${resolvedGuildId}...`);
  await rest.put(Routes.applicationGuildCommands(resolvedAppId, resolvedGuildId), { body: commandData });
  console.info('Guild command registration completed.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

const music = initMusic(client);

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`ToneDial bot logged in as ${readyClient.user.tag}`);
  try {
    await music.connect();
  } catch (error) {
    console.error('Failed to connect to Lavalink', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({ content: 'Command not found.', ephemeral: true });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Failed to run command ${interaction.commandName}`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
    }
  }
});

client.on('error', (error) => {
  console.error('Discord client error', error);
});

const shutdown = async () => {
  console.info('Shutting down ToneDial bot...');
  await client.destroy();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const bootstrap = async () => {
  try {
    const commandData = await loadCommands();
    await registerGuildCommands(commandData);
    await client.login(token);
  } catch (error) {
    console.error('Failed to start bot', error);
    process.exit(1);
  }
};

bootstrap();
