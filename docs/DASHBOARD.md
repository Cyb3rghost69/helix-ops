# Dashboard — HELIX/OPS arcade app

Served by `server.py` on `:8790` (Tailscale `/ops`). `index.html` boots a small single-page app from `app/`:

| File | What |
|---|---|
| `app/arcade.css` | Design system: pink cabinet frame, pixel fonts (Silkscreen / VT323 / IBM Plex Mono via Google Fonts, monospace fallback), panels, nav, boot + loaders, responsive rules |
| `app/core.js` | Helpers, data store + polling, pixel mascots and logo, router, shell (top bar, sidebar, bottom nav, sheets), boot screen |
| `app/mesh.js` | BOTMESH arena engine (canvas) |
| `app/pages.js` | Pages |

The previous dashboard is still available at `/legacy` (also linked as CLASSIC in the menu).

## Pages (hash routes)

| Route | Content |
|---|---|
| `#/` HOME | Helix status line, agent roster, live mini-mesh, Needs You, KPI tiles, fleet chart, latest comms |
| `#/helix` HELIX | Messenger-style chat window: live square pixel avatar of Helix (mood follows real state), chat bubbles, quick replies |
| `#/mesh` MESH | Animated botmesh, comms log (ALL / BOTS / HELIX), inspector, busiest links, agent list |
| `#/agents`, `#/agents/<id>` | Crew grid; per-agent status, conversation, and for Helix the pipeline + terminal (`/api/prompt`); ADZE analysis core |
| `#/trace` | Latest request, pipeline, swimlanes, timeline |
| `#/systems/<hosts|docker|network|remote|security>` | Host cards + fleet chart, Docker (search/filter/start/stop), throughput + LAN clients, RustDesk, hardening.py + Needs You |
| `#/memory/<banks|files|skills>` | Memory banks, SOUL/USER/MEMORY viewer, skills browser |
| `#/settings` | Animation FULL/LITE/OFF, arcade sound, boot FULL/FAST/OFF, replay boot, about |

Desktop: sidebar + top bar. ≤900px: top bar + bottom nav (HOME · MESH · AGENTS · SYSTEMS · MORE sheet). Keys 1–7 switch pages.

## BOTMESH — what moves and why

Two views (toggle on the MESH page, remembered): **ARENA** — agents on a ring, packets fly along glowing links; **FLOOR** — the office from the reference: agents sit at desks, channels/services are stations (Telegram booth, You door, Web window, Tools bench, Honcho cabinet, Unraid/Umbrel racks), and an agent physically walks to whoever it messages, says it, and walks back. The wall screen shows real fleet CPU and the JST clock.

### Live feed (server)

`server.py` runs a `MeshBus` thread that reads every Hermes agent database (Helix + Prefect/Foreman/Canon/Scribe/ADZE profiles) and the Unraid Hermes **worker** (`HELIX_WORKER_DB`, default `/mnt/cache/appdata/hermes-agent/state.db`, read over the existing Unraid SSH key with `sqlite3 -json`; `HELIX_WORKER=off` disables). Each message becomes an event: user → agent (origin = Telegram / You / another agent named in the session source), tool call → target (agent named in the tool/arguments, web, tools, unraid, honcho…), tool result back from the same target, reply → origin. Served at `/api/mesh?since=<seq>` and pushed instantly at `/api/stream` (Server-Sent Events, auto-reconnect; the app falls back to polling `/api/mesh` every 3s). Agents count as online if their gateway is up **or** they had traffic in the last 15 min (silent profiles are one-shot).


Packets are real events, deduplicated by id:

- `/api/talk` — every Helix ↔ silent-profile message (from, to, text, time).
- `/api/trace` (Helix) — REQUEST (Telegram/You → Helix), TOOL (Helix → target), RESULT (target → Helix), RESPONSE (Helix → Telegram/You). Tool names map to nodes: bot names → that bot, web/browser → WEB, docker/unraid → UNRAID, honcho/memory → HONCHO, everything else → TOOLS.

On load the arena **replays** the most recent real messages (labelled REPLAY), then shows LIVE traffic as it arrives. With no traffic for 25s it shows LIVE · QUIET and online agents emit a slow heartbeat ring (offline agents don't). Busy agents (from `/api/agents`) show a dotted "thinking" bubble with what they're doing. Link thickness = message count; colour = the two agents' colours while hot.

## Data + polling

All values come from existing endpoints; missing values show "—" or NO TELEMETRY. Always polled: stats 10s (served from the background snapshot), compute 2s, agents 6s, talk 4s, trace 3s, adze 15s. Page-specific (only while that page is open): docker, remote, clients, git, matrix, memory, skills, thoughts, herdr. Polling pauses while the tab is hidden. Fleet and network history is collected in the browser since page load.

## Boot + loading

Boot screen: pixel logo assembles, then real checks (`/health`, compute, agents, talk, trace, adze, stats) tick OK / WAIT / FAIL, then PRESS START (auto-continues). Later visits in the same session boot FAST; Settings can turn it off. Pages show pixel loaders and skeleton blocks until their data arrives.

## Install as an app

`/manifest.webmanifest` + `/sw.js` make it installable (Safari → Share → Add to Home Screen; Chrome → Install). It opens full-screen with the pixel helix icon. The service worker only caches app files (network-first) so the shell opens offline; it never caches `/api`. Service workers need HTTPS — use the Tailscale `/ops` URL.

## Fonts

Silkscreen, VT323 and IBM Plex Mono are bundled in `app/fonts/` (subset WOFF, OFL licences alongside) — no Google Fonts requests.

Bump `V` in `index.html` and `VERSION` in `sw.js` when shipping UI changes.

## HELIX — avatar + chat

`app/avatar.js` builds Helix entirely in code: no image files. She is a 48×48 pixel rig made of separate layers (back hair, shoulders, neck, face, eyes/brows/mouth, bangs, front locks), each with its own transform: breathing, head bob and tilt, hair sway with dripping purple ends, blinking, gaze, lip-sync, mood props (thinking dots, Zzz, alert “!”, sparkles). The **background is its own layer**: one scene per mood (SUNBURST, CIRCUIT, PULSE, EQ, SPARKLE, HAZARD, NIGHT) cross-fading as her mood changes, or pinned with the BACKDROP chips (saved per browser in `helix.avatarBg`). Mood comes from real state, highest first: **asleep** (gateway down and no chat link), **talking** (reply streaming — mouth moves with each chunk), **thinking** (waiting for her reply, or a live trace), **listening** (you're typing), **happy** (6 s after a reply), **alert** (a HIGH item in Needs You), **calm**. `HelixAvatar.face(mood)` renders the small head icons used in chat bubbles, and a square live badge of her sits on HOME.

The page is laid out like a messaging client window (HELIX.MSG): contact pane with the live avatar, presence (online / thinking… / typing… / away) and what she's doing; chat thread with pixel bubbles, timestamps and ✓✓ read ticks; quick-reply chips; composer.

The chat window talks to Helix through `POST /api/chat` (streamed back as Server-Sent Events). The server forwards the conversation (last 20 turns) to, in order:

| ops.env key | Meaning |
|---|---|
| `HELIX_CHAT_URL` | OpenAI-compatible chat completions URL — Hermes' API server, e.g. `http://127.0.0.1:8642/v1/chat/completions` (streamed) |
| `HELIX_CHAT_KEY` | Bearer key for that API (kept server-side, never sent to the browser) |
| `HELIX_CHAT_MODEL` | Model name the API expects (default `hermes`) |
| `HELIX_CHAT_CMD` | Fallback one-shot CLI; the message is appended as the last argument or replaces `{text}` |
| `HELIX_CHAT_TIMEOUT` | Seconds (default 180) |

No quotes around values in ops.env. `GET /api/chat` reports whether chat is connected. `/clear` in the terminal resets the dashboard transcript (Helix keeps her own memory).
