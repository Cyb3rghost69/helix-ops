# HELIX OS Dual-Brain HA V2 — Phase 1 (read-only)

Date: 2026-10-19 AEDT. No production changes. Canon/Scribe/Foreman/Prefect oneshots timed out (exit 124). Unraid SSH docker inventory skipped.

## Verified map (live)

### Node Alpha — Mac Mini (`Mats-Mac-mini.localdomain`)
- Chip: **Apple M2** (brief said M1; measured `machdep.cpu.brand_string` = Apple M2).
- Hermes: **v0.21.3** (2026.9.14, git `bce20d0b`), git install `~/.hermes/hermes-agent`. 17781 commits behind upstream — do not `hermes update` unless asked.
- **Main Brain + messaging gateway** (launchd `ai.hermes.gateway`, PID 78601). Telegram / Discord / Matrix enabled on default. Multiplex on.
- Profiles (gateway running): default (grok-4.6 / xai-oauth), adze (gpt-4o), canon, community, ecc, foreman, prefect, scribe.
- Loopback API `127.0.0.1:8642` health 200 (v0.21.3). Webhooks `8644`. Mac WebUI `127.0.0.1:8787` 302. LaunchAgent `com.local.hermes-webui`.
- **Helix ops dashboard (`:8790`) is DOWN** — nothing listening on 127.0.0.1, LAN, or Unraid `:8790`. Tailscale Serve `/ops` still points at `http://127.0.0.1:8790`.
- Session store: `~/.hermes/state.db` 69MB SQLite (do not rsync/copy while live). Cron: none.
- Git store: private `Cyb3rghost69/helix-ops`. Ops tree branch `helix-medic` `640cb24`.

### Node Bravo — Unraid `192.168.1.84` (LAN health only; no SSH)
- Hermes-Agent API `:8642/health` 200 **v0.22.2**. Dashboard `:9119` 302. Peer `unraid` on Mac.
- Helix **command** board `:8788` 200 (static nginx). Not Helix ops.
- Honcho `:8000/health` 200, `/docs` 200. Mac `memory.provider=honcho`, `baseUrl=http://192.168.1.84:8000`, workspace `hermes`.
- Matrix client versions `:6167` 200.
- Helix ops is **not** on Unraid.

### Extra peer (not in the brief)
- Umbrel `192.168.1.236:8643/health` 200 **v0.21.5**. Peer `umbrel`. Ping OK.

### Other devices
- Omarchy `192.168.1.207`: ping **loss** (off / not a witness).
- iLO `192.168.1.82`: same chassis as Bravo — not an independent failure domain.

### Network
- Tailscale Serve (tailnet only): `/` → Mac 8787, `/ops` → Mac 8790, `/board` → Unraid 8788, `:8443` → Control Deck 4240.
- Funnel: do not enable. Serve routes left untouched.
- Cloudflare Tunnel / UniFi: not modified.

## What depends on the Mac
- Telegram / Discord / Matrix **ingress** (one bot token / one poller).
- Helix identity in chat.
- Mac `state.db` / sessions / skills / launchd gateway.
- Helix ops UI (when running).
- Tailscale Serve front door for `/` and `/ops`.

## What depends on Unraid
- Honcho (authoritative conversational memory).
- Worker + media specialists (`hermes peer` `/p/worker/` `/p/media/`).
- Command board `:8788`, Unraid Hermes dashboard `:9119`.
- Matrix homeserver, *arr/Plex stack (not re-inventoried this pass).

## Official docs (Hermes)
- Index: https://hermes-agent.nousresearch.com/docs/llms.txt
- **No host-level HA / leader election / dual-gateway product.** “Failover” in docs = LLM **provider** fallback.
- Multi-profile = one process, many profiles: https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways
- Session SQLite WAL: https://hermes-agent.nousresearch.com/docs/user-guide/session-storage-recovery
- Honcho: https://hermes-agent.nousresearch.com/docs/user-guide/features/honcho
- Bot mode: https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode

## Proposed architecture (not built)

1. Keep Alpha as exclusive messaging owner. Bravo stays **passive** for chat tokens (Unraid Telegram stays off).
2. Do **not** rsync `state.db`. Prefer Honcho as shared memory; Mac SQLite remains Alpha-local (session loss on Mac death unless a real multi-writer store is added later).
3. Honcho on Unraid = **Bravo is a remaining SPOF for memory**. Not full infrastructure redundancy.
4. Version skew: Mac 0.21.3 vs Unraid 0.22.2 vs Umbrel 0.21.5 — pin compatible configs before calling them a pair.
5. **Witness: none independent and always-on.** Umbrel is a third Hermes, same LAN. iLO is Bravo BMC. Omarchy offline. **Automatic failover stays OFF** until a third failure domain + fencing exists. Manual promotion only.
6. Dual-Brain dashboard belongs on Helix ops `:8790` (Mac), not Unraid `:8788`. Ops must be running first. No fabricated telemetry.
7. Provider outage (Grok) must **not** switch brains — both use the same cloud provider.

## Blocked / not done
- Unraid docker name inventory (SSH) — alignment oneshot unreachable; tighter plan used LAN ports only.
- Helix ops Dual-Brain panels — `:8790` down.
- Production failover, gateway restart, Cloudflare, UniFi, Funnel, new profiles: not started.

## Rollback
None applied. Discovery only.
