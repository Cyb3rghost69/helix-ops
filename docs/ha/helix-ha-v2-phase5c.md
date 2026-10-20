# Helix OS Dual-Brain HA V2 — Phase 5C

Date: 2026-10-20 AEDT.
Isolated relay **dev** service + tests. No production enroll, no live tokens, no extra Telegram poller, no Hermes source patch, no service restart, no auto failover, no production deploy.

Live: Alpha **0.22.2** gateway PID **76636**; Bravo worker **0.22.2**; Honcho 200; Ops 200.

---

## Connector compatibility (`NousResearch/gateway-gateway`)

Official connector is **Node/TypeScript**, separate repo. Hermes v0.22.2 Python side speaks **contract_version 1** (`CapabilityDescriptor`, outbound WS `/relay`, HMAC enroll). Connector internals (from contract): Redis `RelayBus` for multi-instance, HMAC-SHA256 upgrade tokens, delivery gate (owner ∧ visibility ∧ relevance).

**Compatible as a protocol** with 0.22.2 RelayAdapter. **Not** a dual-brain HA controller: it fronts many *tenants/instances*, not Alpha/Bravo lease. Helix still needs lease-gated “only one brain WS is live.” Experimental; Class-1 = Discord+Telegram.

This phase did **not** clone or run `gateway-gateway`.

---

## Prototype

| File | Role |
|---|---|
| `ha-fence-proto/helix_relay.py` | In-memory handover; platform_up survives switch |
| `ha-fence-proto/helix_relay_svc.py` | Durable SQLite queue, v1 handshake descriptors, dummy TG+Discord sockets, connector crash/recover, dedup |
| `test_helix_relay.py` / `test_helix_relay_c.py` | Relay tests |
| `preview-relay.html` | SIM visualisation (not Ops API) |

Handshake dicts match installed `CONTRACT_VERSION = 1` (telegram utf16 / discord chars). No import of production `gateway.run`.

**Guarantees (sim):** at-most-once inbound via `mid` unique index; stale epoch outbound dropped; handover does not drop dummy platform flags. **Not** exactly-once (Telegram/Discord cannot). Relay process crash ≠ platform token move; inbound held until recover. Relay **host** loss is a **separate** outage (chat mute).

**Single vs active/passive relay:** two connectors with the same bot token = duplicate pollers — forbidden. Passive standby relay may exist **offline** only; promote after fence of the active connector (same as brains).

---

## Tests

`python3 -m unittest test_ha_controller.py test_helix_relay.py test_helix_relay_c.py` → **37 OK**.

Includes: 22 fence + 7 5B relay + 8 5C (handshake, sockets kept, dedup, delayed stale, connector crash/recover, partition, simultaneous backend recover, 127.0.0.1 status GET then shutdown).

**Untested:** real `gateway-gateway`, Matrix connector, production enroll, exactly-once, public WS.

---

## Deployment recommendation (not executed)

- **Relay:** dedicated N100, Ethernet, own UPS, Tailscale, Funnel off, persistent disk for queue.
- **Witness:** **different** host/PDU if possible.
- **Monitoring:** connector process + dummy later real platform WS + lease epoch on Ops (read-only).
- **Recovery:** restart connector; drain SQLite; do not start a second live connector.

## Witness

Still required for brain promote. Relay crash ≠ brain promote. Witness down → freeze switches.

## Matrix

Separate connector implementing contract v1 (`platform: matrix`, Model A context). E2EE/device keys stay on that connector, **not** in Hermes core. Not Class-1. Do not share the Telegram/Discord bot process. Optional later; native Alpha Matrix stays until a real matrix connector exists.

## Blockers

No production connector. No witness hardware. Honcho Unraid SPOF. Experimental API. Bravo token-less (correct).

## Phase 5D (approval)

Do not enroll. Optional: pin `gateway-gateway` version vs 0.22.2 contract in a **dev** clone on loopback. Keep Alpha native pollers.

Stop after 5C.
