# ToneDial

> A feature-rich Discord bot combining music streaming and an interactive game roulette system

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/tonedial)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue)](https://www.docker.com/)

---

## Overview

ToneDial is a TypeScript-based Discord bot built with a modern monorepo architecture. It provides two core functionalities:

1. **Music Player** — Stream high-quality audio via Lavalink with queue management and voice controls
2. **Game Roulette** — Interactive game selection system with Steam library integration, secret voting, and weighted selection

The bot features an embedded Discord Activity UI for real-time interaction, seamless Steam OAuth integration, and a robust backend powered by PostgreSQL and Redis.

---

## Features

### 🎵 Music Player

- **Lavalink Integration** — High-quality audio streaming from multiple sources (YouTube, SoundCloud, Bandcamp)
- **Queue Management** — Per-guild queues with full playback controls
- **Voice Controls** — Join, leave, play, pause, resume, skip, seek, and volume adjustment
- **Crossfade Support** — Optional smooth transitions between tracks

### 🎮 Game Roulette

- **Steam Library Integration** — Link your Steam account and pull your game library automatically
- **Smart Game Filtering** — Automatically filters for multiplayer games based on Steam tags
- **Secret Voting System** — Users submit game proposals privately via embedded Activity UI
- **Weighted Selection** — Fair selection algorithm that balances all games while favoring voted titles
- **Interactive UI** — Embedded Discord Activity with real-time countdown and slot-machine animation
- **Flexible Configuration** — Customize voting time, proposal limits, ownership rules, and pool modes

### 🏗️ Technical Features

- **Monorepo Architecture** — Clean separation between bot, API, activity UI, and shared packages
- **Docker Compose** — Single-command deployment for development and production
- **Type Safety** — Full TypeScript with Zod schema validation
- **Caching Layer** — Redis-powered caching for Steam library data and session locks
- **Database Persistence** — PostgreSQL for users, settings, sessions, and game metadata
- **RESTful API** — Secure backend with JWT authentication for Activity UI
- **Structured Logging** — JSON logs with correlation IDs for debugging

---

## Commands

### Music Commands

- `/music join` — Join your current voice channel
- `/music leave` — Leave the voice channel
- `/music play <url|query>` — Play a song or add to queue
- `/music pause` — Pause playback
- `/music resume` — Resume playback
- `/music skip` — Skip current track
- `/music queue` — View the current queue
- `/music volume <0-100>` — Adjust volume
- `/music seek <timestamp>` — Seek to position

### Roulette Commands

- `/roulette start [options]` — Start a game roulette session
  - `max_proposals` — Max games each user can propose
  - `time_sec` — Voting window duration
  - `ownership` — Ownership validation mode (all/threshold)
  - `min_players` — Minimum player requirement
  - `pool` — Pool mode (intersection/union of libraries)
- `/roulette link` — Link your Steam account
- `/roulette status` — Check current session status
- `/roulette reroll` — Re-run selection on same pool
- `/roulette settings` — Configure server defaults

---

## Quick Start

### Prerequisites

Before running ToneDial, ensure you have the following installed and configured:

#### Required Software

- **[Docker](https://docs.docker.com/get-docker/)** and **[Docker Compose](https://docs.docker.com/compose/install/)**
  Used to run PostgreSQL, Redis, and Lavalink services. Docker Compose orchestrates all services with a single command.

- **[Node.js](https://nodejs.org/)** 20 or higher
  Required for development and building the TypeScript services. Check version with `node --version`.

- **[pnpm](https://pnpm.io/installation)** 10.15.0
  Package manager for the monorepo. Install globally with `npm install -g pnpm@10.15.0`.

#### Required API Keys & Bot Setup

- **Discord Bot Application** ([Discord Developer Portal](https://discord.com/developers/applications))
  Create a new application and enable it as a bot. You'll need:
  - **Bot Token** (`DISCORD_TOKEN`) — From the "Bot" tab
  - **Application ID** (`DISCORD_APP_ID`) — From "General Information"
  - **Public Key** (`DISCORD_PUBLIC_KEY`) — From "General Information"
  - **Guild ID** (`DISCORD_GUILD_ID_DEV`) — Your test server ID (enable Developer Mode in Discord, right-click server → Copy ID)

  **Important:** Enable the following bot permissions:
  - Message Content Intent (required for commands)
  - Server Members Intent (required for user data)
  - Presence Intent (optional, for user status)

- **Steam API Key** ([Steam API Key Registration](https://steamcommunity.com/dev/apikey))
  Required for Steam library integration in the game roulette feature. Register with your Steam account to obtain a key.

#### Optional (Managed by Docker)

These services are automatically provisioned via Docker Compose and don't require separate installation:
- PostgreSQL 16 (database)
- Redis 7 (caching layer)
- Lavalink (audio streaming server)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/tonedial.git
   cd tonedial
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Discord token, Steam API key, and other credentials
   ```

4. **Start with Docker Compose**
   ```bash
   pnpm dev:all
   ```

The bot should now be running and connected to Discord!

---

## Architecture

ToneDial is structured as a monorepo with clear separation of concerns:

```
tonedial/
├── packages/
│   └── shared/          # Shared types, Zod schemas, REST SDK
├── services/
│   ├── bot/             # Discord bot with slash commands
│   ├── api/             # REST API with Steam OAuth
│   └── activity/        # Embedded Activity UI
└── infra/
    ├── docker-compose.yml
    └── lavalink.application.yml
```

**Tech Stack:**
- **Bot:** discord.js v14, Lavalink client
- **API:** Fastify/NestJS, Zod validation, JWT auth
- **Activity:** Vite + React, Discord Embedded SDK
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Audio:** Lavalink

---

## Contributing

Contributions are welcome! ToneDial is a solo developer project aiming for community adoption.

### Development Setup

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Start development environment: `pnpm dev:all`
4. Run tests: `pnpm test`
5. Apply migrations: `pnpm migrate`

### Code Standards

- Write TypeScript with strict mode enabled
- Use Zod for runtime validation
- Follow existing code patterns
- Add tests for new features
- Keep commits atomic and descriptive

---

## License

[ISC](LICENSE)

---

## Roadmap

- [ ] Playlist management and favorites
- [ ] Multi-language support
- [ ] Custom game weight overrides per server
- [ ] Statistics dashboard
- [ ] Integration with other game platforms (Epic, GOG)

---

**Built with ❤️ by solo developer | Powered by Lavalink, Discord.js, and Steam**
