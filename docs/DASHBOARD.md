# Dashboard

Served from this directory by `python3 server.py`.

Desktop ≥768: CRT command centre (plaque, NOC, cockpit).  
Mobile ≤767: Field Terminal first viewport, MODULES for the rest.

Tabs: `[01] OPERATIONS` `[02] NETWORK` `[03] SYSTEM` `[04] ARCHIVE` `[05] TRACE` `[06] REMOTE`.

Static extras must be listed in `server.py` and loaded with the `/ops` prefix plus cache query `hos0492` (bump when shipping UI).

## Command deck (`helix-deck.css` / `helix-deck.js`)

Desktop `[01] OPERATIONS` opens on the COMMAND DECK, a 12-column instrument grid:

1. Instruments — fleet CPU ring, memory ring, network throughput + sparkline, Botmesh segments, hardening score, Needs You count.
2. BOTMESH topology (from `bot_mesh.nodes/edges`) with node list + INSPECT · HERMES core card (gateway, model, kanban bar, last observable events) · ADZE strip (mode is read-only).
3. FLEET COMPUTE stacked share-of-fleet chart · NEEDS YOU queue (`actions` + non-ok `security.findings`).
4. TRACE swimlanes for the latest request (`/api/trace`) · SERVICE MATRIX docker tiles with START/STOP.
5. NETWORK PULSE clients grouped by owner (`/api/clients`) · REMOTE MATRIX ports + peers · SOURCE CONTROL with 14-day commit strip · MEMORY MATRIX bank bars.

Rules: real API fields only; missing values render NO TELEMETRY. Sparklines and the fleet chart use history collected client-side since page load (nothing persisted). The deck's own polls pause while it is hidden. `DECK: ON/OFF` in the sysbar restores the legacy NOC and need-you modules (remembered per browser).

Mobile Field Terminal gets a focus card under the metric strip: tap CPU/MEM/NET/AI/NODES to switch the big value + sparkline; top two Needs You items sit beneath it.

Server additions: `network.ifaces[].rx_bytes/tx_bytes` (throughput deltas) and `git.days` (commits per day, 14 days).
