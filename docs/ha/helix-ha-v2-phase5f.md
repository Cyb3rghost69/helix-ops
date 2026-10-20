# Helix OS Dual-Brain HA V2 — Phase 5F

Date: 2026-10-20 AEDT (re-verified same day: official connector still 404; **39** tests OK — 37 sim + 2 real transport).
No production enroll, tokens, Hermes patches, restarts, routing, Honcho, or Umbrel Bitcoin. Auto failover **off**.

Live: Alpha **0.22.2** messaging; Bravo `Hermes-Agent` worker; Honcho 200.

---

## Task 1 — Official connector location

| Probe | Result |
|---|---|
| `github.com/NousResearch/gateway-gateway` | **404** |
| GitHub API same | **404** |
| `api.github.com/search/repositories?q=org:NousResearch+gateway+relay` | **total_count 0** |
| npm `gateway-gateway` / `@nousresearch/gateway-gateway` | **404** |
| Docker Hub `nousresearch/gateway-gateway` | **404** |

Docs still name Node `NousResearch/gateway-gateway` (`relayAuthToken.ts`, Redis `RelayBus`). **Renamed, private, or unpublished.** No official package to download. No third-party substitute used.

---

## Task 2 — Installed v0.22.2 contract (source)

`gateway/relay/ws_transport.py`: newline JSON. Gateway → `hello`, `outbound`, `interrupt`, `going_idle`, `inbound_ack`. Connector → `descriptor`, `inbound`, `outbound_result`, `interrupt_inbound`, `going_idle_ack`, `passthrough_forward`. Dial `ws(s)://…/relay`. HMAC bearer `make_upgrade_token` (`auth.py`). `CONTRACT_VERSION = 1`. Experimental; breaking changes lockstep with connector.

**Minimum standalone connector:** `/relay` WS, verify HMAC, `descriptor` after `hello`, `outbound_result` with nested `result`, optional inbound + `bufferId` ack, refuse dual live sessions per bot token.

**Break risk:** `contract_version` bump, frame names, auth encoding, required hello fields.

---

## Task 3 — Helix-owned loopback connector

`ha-fence-proto/helix_ws_connector.py` — dummy `gw-helix-iso` / dummy secret (not production). Speaks v1 frames.

**Against real `WebSocketRelayTransport`** (installed Hermes, not a fake client):

Mac venv: **2/2 OK** (handshake+auth+outbound; bad secret → 4401).  
Unraid `--network none --entrypoint python3 PYTHONPATH=/opt/hermes`: **2/2 OK**. Container removed. Production 8642 still 200.

This is **not** `gateway-gateway`. **Not** Telegram/Discord.

---

## Verification levels (do not inflate)

| Level | What | Result |
|---|---|---|
| 1. Pure simulation | 37 Helix fence/relay unit tests | Previously OK; not re-claimed as connector proof |
| 2. Real RelayAdapter/transport | Loopback WS + installed `WebSocketRelayTransport` | **4 tests OK** (2 Mac + 2 Unraid) |
| 3. Real platform connector | Official Node connector + TG/Discord | **Not achieved** (repo 404) |
| 4. Production validation | Enroll / live bots | **Not done** |

---

## Architecture / feasibility

A **small Helix-owned connector** is **feasible** at protocol v1 for isolated HA experiments: independent of Hermes upgrades if it only speaks the WS contract. Alpha/Bravo would each dial out; connector admits **one** lease-holder.

**Limitations:** must track experimental contract; no Redis multi-instance; no Discord ACL gate; no Matrix E2EE; HMAC must stay compatible; maintaining a private connector is ongoing work vs waiting for official `gateway-gateway`.

**Manual recovery (3 boxes):** keep Alpha native pollers. Unraid = isolated tests. Charlie observer. Fence before any second poller.

---

## Safest next step

Stay **no-relay in production**. Optional 5G: grow Helix WS connector (inbound events, ack, queue) still loopback. Or obtain official connector from Nous. **No auto failover.**

Stop after 5F.
