const DISCORD_SDK_URL = 'https://cdn.discordapp.com/embedded-app-sdk/embedded-app-sdk.min.js';

export type DiscordContext = {
  guild?: { id: string };
  channel?: { id: string };
  user?: { id: string };
};

export type DiscordClient = {
  ready: () => Promise<void>;
  commands: {
    getContext: () => Promise<DiscordContext>;
    authorize?: (options: { client_id: string; scope: string[] }) => Promise<void>;
  };
};

let discordInstance: DiscordClient | null = null;

export async function initDiscord() {
  if (typeof window === 'undefined') {
    throw new Error('Discord SDK is only available in the browser.');
  }

  if (discordInstance) {
    console.log('[Discord SDK] Using existing SDK instance');
    try {
      const ctx = await discordInstance.commands.getContext();
      return { sdk: discordInstance, ctx };
    } catch (error) {
      console.error('[Discord SDK] Failed to get context from existing instance:', error);
      throw new Error(`Failed to get Discord context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    console.log('[Discord SDK] Initializing Discord SDK...');
    await ensureSdkLoaded();
    const DiscordSDKConstructor = (window as typeof window & { DiscordSDK?: new (id: string) => DiscordClient }).DiscordSDK;
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('cid') ?? import.meta.env.VITE_DISCORD_CLIENT_ID;

    if (!DiscordSDKConstructor || !clientId) {
      throw new Error('Discord Embedded App SDK unavailable or missing VITE_DISCORD_CLIENT_ID.');
    }

    console.log('[Discord SDK] Creating SDK instance with clientId:', clientId);
    discordInstance = new DiscordSDKConstructor(clientId);
    console.log('[Discord SDK] Calling ready()...');
    await discordInstance.ready();
    console.log('[Discord SDK] SDK ready, fetching context...');
    const ctx = await discordInstance.commands.getContext();
    console.log('[Discord SDK] Context fetched:', ctx);
    return { sdk: discordInstance, ctx };
  } catch (error) {
    console.error('[Discord SDK] Initialization failed:', error);
    console.error('[Discord SDK] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      clientId: new URLSearchParams(window.location.search).get('cid') ?? import.meta.env.VITE_DISCORD_CLIENT_ID,
      sdkLoaded: !!(window as typeof window & { DiscordSDK?: unknown }).DiscordSDK,
    });
    throw new Error(`Discord SDK initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureSdkLoaded() {
  if ((window as typeof window & { DiscordSDK?: unknown }).DiscordSDK) {
    console.log('[Discord SDK] SDK already loaded');
    return;
  }

  console.log('[Discord SDK] Loading SDK from CDN:', DISCORD_SDK_URL);
  try {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DISCORD_SDK_URL;
      script.async = true;
      script.onload = () => {
        console.log('[Discord SDK] SDK script loaded successfully');
        resolve();
      };
      script.onerror = (event) => {
        console.error('[Discord SDK] Script loading error:', event);
        reject(new Error(`Failed to load Discord Embedded App SDK from ${DISCORD_SDK_URL}`));
      };
      document.head.appendChild(script);
    });
  } catch (error) {
    console.error('[Discord SDK] Failed to load SDK script:', error);
    throw new Error(`Discord SDK script loading failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

declare global {
  interface Window {
    DiscordSDK?: new (clientId: string) => DiscordClient;
  }
}
