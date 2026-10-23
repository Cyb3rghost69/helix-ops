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
| `#/mesh` MESH | Animated botmesh, comms log (ALL / BOTS / HELIX), inspector, busiest links, agent list |
| `#/agents`, `#/agents/<id>` | Crew grid; per-agent status, conversation, and for Helix the pipeline + terminal (`/api/prompt`); ADZE analysis core |
| `#/trace` | Latest request, pipeline, swimlanes, timeline |
| `#/systems/<hosts|docker|network|remote|security>` | Host cards + fleet chart, Docker (search/filter/start/stop), throughput + LAN clients, RustDesk, hardening.py + Needs You |
| `#/memory/<banks|files|skills>` | Memory banks, SOUL/USER/MEMORY viewer, skills browser |
| `#/settings` | Animation FULL/LITE/OFF, arcade sound, boot FULL/FAST/OFF, replay boot, about |

Desktop: sidebar + top bar. ≤900px: top bar + bottom nav (HOME · MESH · AGENTS · SYSTEMS · MORE sheet). Keys 1–7 switch pages.

## BOTMESH — what moves and why

Packets are real events, deduplicated by id:

- `/api/talk` — every Helix ↔ silent-profile message (from, to, text, time).
- `/api/trace` (Helix) — REQUEST (Telegram/You → Helix), TOOL (Helix → target), RESULT (target → Helix), RESPONSE (Helix → Telegram/You). Tool names map to nodes: bot names → that bot, web/browser → WEB, docker/unraid → UNRAID, honcho/memory → HONCHO, everything else → TOOLS.

On load the arena **replays** the most recent real messages (labelled REPLAY), then shows LIVE traffic as it arrives. With no traffic for 25s it shows LIVE · QUIET and online agents emit a slow heartbeat ring (offline agents don't). Busy agents (from `/api/agents`) show a dotted "thinking" bubble with what they're doing. Link thickness = message count; colour = the two agents' colours while hot.

## Data + polling

All values come from existing endpoints; missing values show "—" or NO TELEMETRY. Always polled: stats 10s (served from the background snapshot), compute 2s, agents 6s, talk 4s, trace 3s, adze 15s. Page-specific (only while that page is open): docker, remote, clients, git, matrix, memory, skills, thoughts, herdr. Polling pauses while the tab is hidden. Fleet and network history is collected in the browser since page load.

## Boot + loading

Boot screen: pixel logo assembles, then real checks (`/health`, compute, agents, talk, trace, adze, stats) tick OK / WAIT / FAIL, then PRESS START (auto-continues). Later visits in the same session boot FAST; Settings can turn it off. Pages show pixel loaders and skeleton blocks until their data arrives.

Bump `V` in `index.html` when shipping UI changes.
