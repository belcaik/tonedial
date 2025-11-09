# ToneDial — agents.md

## Objetivo

Bot de Discord en TypeScript con dos funciones:

1. Música vía **Lavalink**.
2. **Ruleta de juegos** con UI embebida, vínculo a **Steam**, votos secretos y selección ponderada.

Monorepo, Dockerizado, infra mínima: Lavalink + Postgres + Redis + API + Bot + Activity UI.

---

## Arquitectura lógica

* **packages/**

  * `shared/` tipos, zod schemas, SDK REST.
* **services/**

  * `bot/` Discord slash commands, voz, ruleta orquestación.
  * `api/` REST + Steam OpenID + reglas de negocio.
  * `activity/` web UI embebida para configuración/votación/animación.
* **infra/**

  * `docker-compose.yml`, `lavalink.application.yml`, migraciones SQL.

---

## Agentes y responsabilidades

### 1) Agent: Bot (Discord)

**Inputs:** Interactions, eventos de voz, webhooks del API.
**Outputs:** Respuestas efímeras/embeds, control de player de audio, arranque de Activity.
**Tareas:**

* Registrar slash:

  * `/music join|leave|play|pause|resume|skip|queue|volume|seek`
  * `/roulette start [max_proposals] [time_sec] [ownership] [min_players] [pool]`
  * `/roulette link` `/roulette status` `/roulette reroll` `/roulette settings`
* Conectar a Lavalink. Gestionar colas por guild.
* Orquestar sesión de ruleta: detectar participantes del canal de voz, validar vínculos Steam, abrir Activity, cerrar votación, anunciar resultado.
  **DoD:** comandos idempotentes, rate-limit safe, reconexión de voz, logs estructurados.

### 2) Agent: API (Back-end)

**Inputs:** OAuth/OpenID Steam, requests del Bot y Activity.
**Outputs:** JSON seguro, JWT corto para Activity, cachés en Redis.
**Tareas:**

* `POST /auth/steam/callback` → `steamid64`.
* `GET /steam/owned/:steamid?force=` cache 24h con invalidación on-demand.
* `POST /roulette/session` | `POST /roulette/vote` | `POST /roulette/close`.
* Enriquecimiento de juegos: `appdetails` para etiquetas multiplayer.
  **DoD:** validaciones zod, límites por IP/guild, transacciones DB, tests E2E.

### 3) Agent: Activity UI

**Inputs:** Contexto de canal/usuarios, JWT del API.
**Outputs:** Pantalla de configuración, panel de propuestas ocultas, temporizador, animación tipo slot.
**Tareas:**

* Estado en tiempo real via SSE/WebSocket del API.
* Controles: `max_proposals`, `time_sec`, reglas de ownership/union|intersection.
* Render de ruleta con easing y aterrizaje en el juego elegido.
  **DoD:** accesible, 60 FPS, fallback a componentes si Activity no carga.

### 4) Agent: DevOps

**Tareas:**

* Compose local y despliegue.
* Healthchecks, readiness, rotación de logs.
* Observabilidad: métricas de latencia de interacción, errores de voz, cache hit.
  **DoD:** `docker compose up` operativo en <1 min en dev, secrets fuera del repo.

### 5) Agent: QA

**Tareas:**

* Tests unitarios de ponderación y muestreo.
* E2E simulando 3-5 usuarios con librerías mock.
* Pruebas de reconexión Lavalink y expiración de sesión.
  **DoD:** cobertura mínima 80% en reglas críticas.

---

## Especificación funcional

### Música

* Fuente de audio vía **Lavalink**. El bot solo controla y transmite al canal de voz.
* Colas por guild, crossfade opcional, `volume` con clamp.

### Ruleta

* Pool inicial: intersección o unión de librerías Steam según parámetro.
* Validaciones:

  * Todos los participantes poseen el juego (o umbral configurable).
  * Etiquetas multiplayer válidas; opcional `min_players` cumplido.
* Votos secretos por usuario, hasta `max_proposals`.
* Pesos:

  * Base `B=1` para todos los juegos.
  * Cada voto añade `B*w` (por defecto `w=0.25`).
  * Peso final `weight = B + n*(B*w)`. Siempre `prob > 0`.
* Selección: muestreo ponderado (alias method). Persistencia de snapshot.

---

## Modelo de datos (Postgres)

* `users(id_discord PK, tz, created_at)`
* `steam_links(user_id FK, steamid64, visibility_ok bool, linked_at)`
* `games(appid PK, name, categories text[], is_multiplayer bool, max_players int null, updated_at)`
* `guild_settings(guild_id PK, vote_window_sec int, base_weight float, vote_weight_pct float, pool_mode text, ownership_mode text)`
* `roulette_sessions(id PK, guild_id, text_channel_id, voice_channel_id, created_by, state, max_proposals int, started_at, closed_at)`
* `roulette_participants(session_id FK, user_id FK)`
* `roulette_votes(session_id FK, user_id FK, appid, created_at)`
* `roulette_results(session_id PK, appid, weights jsonb, chosen_at)`

Índices por `guild_id`, `appid`, `session_id`.

---

## Endpoints API (resumen)

* `POST /auth/steam/callback` → set-cookie o retorno al bot con `steamid64`.
* `GET /steam/owned/:steamid?force=true|false`
* `POST /roulette/session` body: reglas
* `POST /roulette/vote` body: `{session_id, appid}`
* `POST /roulette/close` → calcula pesos y elige
* `GET /games/:appid` → metadatos cacheados

Auth: JWT corto para Activity; firma HS256; TTL 10 min.

---

## Redis (locks y caché)

* `lock:guild:{id}:roulette` TTL = ventana de voto + 10 s.
* `cache:steam:owned:{steamid}` TTL 24 h.
* Streams para eventos de sesión si se requiere.

---

## docker-compose (dev)

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: tonedial
    ports: ["5432:5432"]
    volumes: [pg:/var/lib/postgresql/data]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  lavalink:
    image: fredboat/lavalink:latest
    environment:
      _JAVA_OPTIONS: "-Xmx512m"
    volumes:
      - ./infra/lavalink.application.yml:/opt/Lavalink/application.yml:ro
    ports: ["2333:2333"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:2333/version"]
      interval: 10s
      timeout: 3s
      retries: 10

  api:
    build: ./services/api
    env_file: .env
    depends_on: [postgres, redis]
    ports: ["8080:8080"]

  bot:
    build: ./services/bot
    env_file: .env
    depends_on: [api, lavalink, redis]
    restart: unless-stopped

  activity:
    build: ./services/activity
    env_file: .env
    depends_on: [api]
    ports: ["5173:5173"]

volumes:
  pg:
```

**infra/lavalink.application.yml**

```yaml
server:
  port: 2333
lavalink:
  server:
    password: ${LAVALINK_PASSWORD:-youshallnotpass}
    sources:
      youtube: true
      bandcamp: true
      soundcloud: true
      http: true
    bufferDurationMs: 400
```

---

## Variables de entorno (.env ejemplo)

```
# Discord
DISCORD_TOKEN=
DISCORD_PUBLIC_KEY=
DISCORD_APP_ID=
DISCORD_GUILD_ID_DEV=

# Lavalink
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass

# Steam
STEAM_API_KEY=
STEAM_RETURN_URL=https://api.example.com/auth/steam/callback

# API
API_PORT=8080
API_JWT_SECRET=change_me

# DB
PGHOST=postgres
PGPORT=5432
PGDATABASE=tonedial
PGUSER=postgres
PGPASSWORD=postgres

# Redis
REDIS_URL=redis://redis:6379
```

---

## Flujos clave

### Vincular Steam

1. `/roulette link` → botón a `STEAM_RETURN_URL`.
2. Callback extrae `steamid64`, guarda vínculo, valida privacidad “Game details”.
3. Bot confirma estado al usuario.

### Iniciar ruleta

1. `/roulette start max_proposals:X time_sec:60 ownership:all|threshold pool:intersection|union`.
2. Bot detecta miembros en voz; valida vínculos.
3. Activity UI abre. Cuenta regresiva.
4. Usuarios proponen hasta X juegos en secreto.
5. Cierra, calcula pesos, selecciona, anima slot, publica embed.

### Música

* `/music join` conecta a voz.
* `/music play <url|query>` crea track en Lavalink.
* `/music ...` resto de controles estándar.

---

## Algoritmo de ponderación

```ts
const B = 1;              // peso base
const W = 0.25;           // incremento por voto
// votosPorJuego: Map<appid, count>
const weights = [...pool].map(appid => {
  const n = votosPorJuego.get(appid) ?? 0;
  return { appid, w: B + n * (B * W) };
});
// normalización
const total = weights.reduce((s, x) => s + x.w, 0);
const probs = weights.map(x => ({ appid: x.appid, p: x.w / total }));
// selección alias o ruleta acumulada
```

---

## Validaciones de juego

* `is_multiplayer == true` por etiquetas.
* `ownership` según modo seleccionado.
* `min_players` si está disponible; si falta, aplicar override por servidor.

---

## Tareas de construcción

### Bot

* `discord.js` v14, `@discordjs/voice`, cliente Lavalink.
* Registro de slash por guild en dev y global en prod.
* Manejo de collectors con TTL, limpieza al finalizar.

### API

* Fastify/NestJS.
* Steam OpenID 2.0.
* Endpoints con zod, rate limit y caching.
* Migraciones SQL (drizzle/knex).

### Activity

* Vite + React/Preact.
* SDK embebido de Discord.
* Estado local + canal de eventos desde API.

---

## Observabilidad

* Logs JSON `pino` con `guild_id`, `session_id`, `op`.
* Métricas: latencia de interacción, tiempo de conexión a voz, cache hit Steam, errores Lavalink.

---

## Seguridad

* JWT corto para Activity, CORS estricto.
* No almacenar tokens sensibles de terceros.
* Sanitizar nombres de juegos en UI y embeds.

---

## QA: casos mínimos

* Selección ponderada estable con 0, 1 y N votos.
* Vínculo Steam fallido por privacidad.
* Reintento de conexión Lavalink.
* Cancelación si owner abandona voz.
* Sesión paralela en otro canal bloqueada por lock.

---

## Scripts sugeridos

* `pnpm dev:all` → compose + watch de servicios.
* `pnpm migrate` → aplicar migraciones.
* `pnpm seed` → insertar overrides de juegos.
* `pnpm test` → unit + e2e.

---

## Criterios de aceptación MVP

* `docker compose up` arranca Postgres, Redis, Lavalink, API, Bot, Activity.
* `/roulette start` funcional con votos secretos y animación.
* `/roulette link` obtiene librería y filtra multiplayer.
* `/music play` reproduce vía Lavalink de forma estable.
* Logs y métricas básicas visibles.
