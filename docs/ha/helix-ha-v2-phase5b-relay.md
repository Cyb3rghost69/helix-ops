# Helix OS Dual-Brain HA V2 — Phase 5B (Relay)

Date: 2026-10-20 AEDT.
Mode: research + isolated prototype. **Did not** change production gateway config, transfer credentials, start extra pollers, restart services, modify Honcho, patch installed Hermes, activate auto failover, deploy a production relay, or change routing.

Live: Alpha **0.22.2** gateway PID **76636**; Bravo **0.22.2** worker; Honcho 200; Ops 200.

Official docs (in-tree, same as published):
- `website/docs/user-guide/messaging/relay.md`
- `website/docs/developer-guide/relay-connector-contract.md`

---

## 1. Native relay compatibility verdict

**RelayAdapter exists on this 0.22.2 install.**  
`gateway/relay/adapter.py`, `WebSocketRelayTransport`, config via `GATEWAY_RELAY_URL` / `gateway.relay_url`. Experimental. Public API **may change** until ≥2 Class-1 platforms (Discord + Telegram) validate the schema.

**What it is:** a *connector* owns bot tokens and platform sockets. The Hermes **gateway dials out** over one authenticated WebSocket, gets a `CapabilityDescriptor`, then exchanges normalized inbound events and outbound actions. Gateway never opens an inbound port. Platform secrets stay on the connector.

**What it is not:** host HA, dual-brain leadership, or automatic backend switching. Official “when to use” is hosted/multi-tenant connectors, not Alpha/Bravo failover. Native relay **does not** provide high availability by itself.

**Connector implementation:** Node/TypeScript **`NousResearch/gateway-gateway`** (not in this Python tree). A stub exists only under `tests/gateway/relay/stub_connector.py` (must not ship in plugins/).

**Auth:** `hermes gateway enroll` → `GATEWAY_RELAY_ID` / `_SECRET` / `_DELIVERY_KEY`. IdP or Nous Portal. **Do not enroll production.**

**Reconnect / buffer:** connector buffers inbound while gateway idle/disconnected; ack-gated replay; optional wake URL. `go_idle` / buffered flip is for sleep, not dual-active brains.

**Unstable:** contract_version 1, additive-only during experiment; handshake ops list; enrollment secrets.

---

## 2. Supported platforms (negotiated)

Class-1 target: **Discord + Telegram**. Docs also mention Slack, WhatsApp. Matrix appears in session/cron docs and `supports_context` (Model A) — **not** listed as a Class-1 relay validator. Capability (edit, threads, markdown, media ≤25 MB, buttons) is **handshake-negotiated**. Streaming degrades if `supports_edit` is false.

Helix production today: Telegram poll + Discord WS + Matrix sync on **Alpha native adapters**. Matrix E2EE/device store does not automatically move to a connector.

---

## 3. Recommended Helix Relay architecture

```
[Telegram/Discord/Matrix] 
        │  tokens live here only
   Helix Connector (gateway-gateway or thin equivalent)
        │  one WS to the *lease-holding* brain
   Alpha RelayAdapter  XOR  Bravo RelayAdapter
        │
   Honcho (Unraid) — still a memory SPOF
```

- Connector owns platform connections (does not flap on brain switch).
- **Only the authorised brain** may complete handshake / receive inbound.
- Replies tagged with **lease epoch**; stale epochs dropped.
- Hermes updates stay on Alpha/Bravo **without** forking `gateway/platforms/telegram`.
- If native connector cannot select backends: minimum extra piece is a **lease-gated WS accept** in front of `/relay` (standalone, not a Hermes core patch).

Fail closed if lease uncertain. Do not run native Telegram adapters **and** relay on the same bot token.

---

## 4. Ownership / queues (design)

Exclusive platform socket on connector. Durable inbound buffer (native already). Message ids + epoch on every outbound. Dedup by platform message_id. In-flight: drop or park until new holder; never deliver Alpha’s late reply after Bravo owns epoch N+1. Failback: fence, then connect Bravo/Alpha RelayAdapter, then drain buffer.

---

## 5. Failure handling (design)

| Failure | Messaging | Brains |
|---|---|---|
| Alpha down | Connector holds socket; buffer; switch backend after fence | Bravo may process if lease granted |
| Bravo down | No effect if Alpha holds | Worker jobs only |
| Relay process/host down | **Chat dead** until relay recovers — new SPOF | Brains up but mute |
| Witness down | Freeze backend switch | Keep current holder |
| Partition | No second poller; connector is source of truth for socket | |
| Both brains down | Buffer only; no replies | |

Relay resilience ≠ brain resilience. One relay is a SPOF until it has its own HA.

---

## 6. Where to host (not deployed)

| Host | Verdict |
|---|---|
| Mac Mini | Dies with Alpha — bad for Alpha-down |
| Unraid | Dies with Bravo/Honcho — bad for Unraid-down |
| Same box as witness | Shared power/switch; not independent |
| **Dedicated N100** | **Best** for connector+queue; witness still separate if possible |

---

## 7. Isolated prototype

`~/.hermes/reports/ha-fence-proto/helix_relay.py` + `test_helix_relay.py`  
Dummy inbound/outbound, epoch drop, handover **without** dropping `platform_up`.  
**29 tests OK** (22 fence + 7 relay). No ports, no tokens, no production WS.

Preview: `preview-relay.html` (SIM). No Helix Ops production routes added.

---

## 8. Additional software (if 5C)

- Official connector `NousResearch/gateway-gateway` **or** a tiny lease-gated WS proxy
- Persistent queue (SQLite/Postgres) on the relay host
- Still **no** Hermes core fork

---

## 9. Limitations

Experimental API. Matrix E2EE not a first-class Class-1 relay. Native relay ≠ HA. Connector is a new SPOF. BlueBubbles stays Mac-local. Honcho still Unraid.

## 10. Phase 5C (approval)

Do not enroll production. Optional: spec the N100 connector + lease accept filter. Keep Alpha native pollers until cutover is designed and approved.

Stop after 5B.
