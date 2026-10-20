# Helix OS Dual-Brain HA V2 — Phase 5E

Date: 2026-10-20 AEDT.
No production gateway/token/Honcho/Umbrel Bitcoin/Hermes patch/restart/auto failover.

Live: Alpha **0.22.2** messaging; Bravo worker; Honcho 200; Ops 200.

---

## 1. Real connector — **BLOCKED**

`https://github.com/NousResearch/gateway-gateway` → **HTTP 404** (GitHub HTML and API). No public clone, no npm run, no isolated Node process.

Therefore these were **not** executed against the official connector:

WebSocket handshake · auth · envelopes · capability negotiation · connection recovery · ack · queue persistence · stale epoch (on **gateway-gateway**).

**Do not treat Helix sim tests as this proof.**

### What *was* executed (adapter-side only)

| Test | Result | Is official connector? |
|---|---|---|
| Import `CapabilityDescriptor` contract v1 | OK (`telegram` / utf16) | No |
| Dummy `make_upgrade_token('gw-iso-test', dummy)` | OK, 116-char HMAC | No |
| Helix proto 37 tests (Mac) | OK | No |
| Unraid `--network none` 37 tests (5D) | OK | No |

Hermes `pytest tests/gateway/relay/` not run (`venv` has no pytest). Stub connector is **not** `gateway-gateway`.

**Blocker:** private/missing Node repo + Redis bus + enroll. Need Nous access or a published tarball before real WS tests.

---

## 2. Hardware (existing three)

Charlie is **not** a production witness.

| Arrangement | Survives Mini death | Survives Unraid death | Survives Umbrel death |
|---|---|---|---|
| **No relay (today)** | Chat **down** (tokens on Alpha) | Chat **up** (Alpha native); Honcho **down** | Chat up |
| Relay on Alpha | Chat down | Chat up if tokens still on Mini | Chat up |
| Relay on Bravo | Chat **up** (connector on Unraid, Bravo brain) | Chat **down** + Honcho down | Chat up |
| Passive second relay | Only if **offline** and exclusive token; two live pollers = split-brain | same | — |
| Manual no-relay recover | Stop Alpha poller, fence, then one Bravo poller | Keep Alpha pollers | — |

**Recommendation:** **keep production as no-relay (Alpha native).** Isolated tests stay on Unraid. Do not put production tokens on Bravo or Charlie. Charlie = observer.

---

## 3. Manual recovery (paper — not executed)

**Always:** exclusive ownership. **Fence / confirm old poller dead** before any second `getUpdates`. No auto promote.

1. **Alpha process crash** — wait launchd; Terminal `hermes gateway status`. Do not start Bravo tokens.
2. **Alpha hardware dead** — confirm Mini unreachable; Honcho still Unraid; **manual** Bravo poller only after fence. Blocked until tokens are copied **once** (not done).
3. **Bravo dead** — chat unchanged; worker/Honcho may die; do not touch Alpha pollers.
4. **Honcho dead** — chat without memory; restore from UNAS dump onto **new** PG (approval). Not this phase.
5. **Relay process/host** — N/A in production (no relay). If later: chat mute until that host returns; do not start native pollers **and** relay.
6. **Partition** — keep current owner; no second poller.
7. **Power outage** — Alpha launchd gateway should take chat; Bravo stay token-less; ops may need LaunchAgent; Honcho with Unraid.

---

## 4. Message reliability (demonstrated vs not)

**Demonstrated (sim / adapter HMAC only):** at-most-once inbound `mid` dedup; stale-epoch outbound drop; dummy queue sqlite; dummy HMAC token shape.

**Not demonstrated:** at-least-once, lost-message recovery on Telegram/Discord, exactly-once, real WS ack, conversation continuity across brains.

Platforms do not guarantee exactly-once.

---

## 5. Honcho (read-only)

Last local dump seen: `honcho-20261020-033001.dump` 925807 B (Phase 4E independently hashed). Isolated restore passed 4B. **No restore this phase.** If Unraid gone: restore dump to a **new** PG 15+pgvector (Mac or elsewhere), point `honcho.json` `baseUrl`, do not dual-write `honcho_pgdata`.

---

## 6. Helix Ops

No production routes. SIM board: `ha-fence-proto/preview-recovery.html`. Controls disabled.

---

## 7. Blockers / next

Real `gateway-gateway` inaccessible. No independent witness. No production fencing. Extra hardware still required for three independent domains.

**5F (approval):** obtain connector source **or** stay no-relay; still no auto HA.

Stop after 5E.
