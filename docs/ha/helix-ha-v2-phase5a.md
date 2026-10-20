# Helix OS Dual-Brain HA V2 — Phase 5A

Date: 2026-10-20 AEDT.
Scope: **isolated prototype only**. No production failover, no gateway edits, no credentials, no SSH keys, no Docker socket, no iLO.

Live (unchanged): Alpha Hermes **0.22.2** gateway PID **76636**; Bravo **0.22.2** worker; Honcho 200; Helix Ops `:8790` 200; auto failover off.

Honcho backup 20 Oct 03:30 AEDT remains independently checksum-verified (Phase 4E). Umbrel = non-voting observer only, not a witness.

---

## Prototype

Path: `~/.hermes/reports/ha-fence-proto/`

| File | Role |
|---|---|
| `ha_controller.py` | Simulated Alpha/Bravo/witness, 60s lease, epochs, fence tokens, exclusive dummy gateway flag |
| `test_ha_controller.py` | 22 scenarios |
| `preview.html` | Standalone SIM UI (no Helix Ops API) |
| `state.json` / `events.jsonl` | Simulated state only |

Bound to this directory. Dummy gateway identity `"dummy-telegram-sim"` is not used as a secret; no production tokens imported. No listen port.

**Rules enforced**
- One `gateway_on` node.
- Promote is **manual**; `auto=True` raises `auto_promote_disabled`.
- Heartbeat timeout → `UNCERTAIN`, no promote.
- Expired lease without fence → refuse.
- Fence token + epoch monotonic; stale rejected.
- Recovered former leader starts **passive**.
- Witness/controller down → freeze / no quorum.
- Failback requires `approved=True`.

**Naive 2-of-3:** `naive_quorum_elect` can return Alpha on one side and Bravo on the other. Prototype still requires fence — that is why 2-of-3 without fencing is insufficient.

Lease TTL in proto: **60s** (15s too tight; documented in 4C).

---

## Tests (22/22 PASS)

`python3 -m unittest test_ha_controller.py` → **OK** (0.001s).

PASS: exclusive owner; auto-promote refuse; timeout; expired lease; manual promote after fence; stale fence token; stale epoch; recovered leader passive; witness crash; controller crash freeze; partition; naive split-brain demo; duplicate promote idempotent; failed shutdown blocks; Alpha crash; Bravo crash; simultaneous restart; delayed HB; controlled failback; concurrent second promote; persist has `"production": false`.

Passing this suite is **not** production fencing readiness.

---

## Real gateway integration (research only — not patched)

Hermes v0.22.2 is **per-host**:
- `gateway.lock` / `runtime_ownership.reserve` — one process per HERMES_HOME, **not** cross-machine.
- Telegram: single `getUpdates` long-poll (`Conflict: terminated by other getUpdates request` if two pollers).
- Discord: one websocket session per bot token.
- Matrix: one device sync / E2EE store.

Safe future hooks (do not implement now):
1. **Startup gate** in `acquire_gateway_runtime_lock` / adapter `start`: refuse poll if lease file says this host is not owner.
2. **Renewal** on heartbeat thread: drop adapters if epoch revoked.
3. **Shutdown** on fence: stop Telegram/Discord/Matrix adapters **before** the other host starts.
4. **Reconnection prevention:** Bravo must not have tokens on disk until fence.

Production code was **not** modified.

---

## Helix Ops

No new production routes. Visualisation is `preview.html` (SIM banner). Live BRAINS `[18]` untouched this phase.

---

## Security check

No production Telegram/Discord/Matrix/Honcho/SSH/iLO credentials. No privileged containers. No public bind. No restart of Hermes/Honcho/Unraid.

---

## Remaining production blockers

No independent voting witness; no STONITH on Mac; no cross-host lease store; Bravo must stay token-less; Honcho still Unraid SPOF; passing sim ≠ fenced production.

## Phase 5B (approval)

Witness hardware; design-only gateway startup gate; still no auto HA.

Stop after 5A.
