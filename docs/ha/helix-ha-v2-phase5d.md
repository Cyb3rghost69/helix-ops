# Helix OS Dual-Brain HA V2 — Phase 5D

Date: 2026-10-20 AEDT.
Hardware constraint: **no N100**. Hosts: Alpha Mac Mini M2, Bravo Unraid DL385, Charlie Umbrel EliteDesk 800 G3.

Did **not** enroll production, move tokens, restart Hermes-Agent/Honcho, touch Umbrel Bitcoin, or enable auto failover.

Live after test: Alpha **0.22.2** (Mac gateway), Bravo **Hermes-Agent** still the only that name, Honcho 200, Umbrel Hermes `:8643` 200.

---

## Isolated Unraid test (prototype ≠ production)

Copied dummy proto to `/mnt/user/backups/helix-relay-proto/` (not Hermes appdata).

First `docker run` used the image **entrypoint** (s6 started a throwaway gateway in `--network none`). That container **`--rm`** exited. Production `Hermes-Agent` was not that name.

Second run: `--entrypoint python3 --network none --name helix-relay-5d-test` (removed after).

**37 tests OK** on Unraid (28s). Dummy credentials only.

Production placement is **not** this container.

---

## What three computers can actually buy

| Role | Alpha (Mini) | Bravo (Unraid) | Charlie (Umbrel) |
|---|---|---|---|
| Messaging primary today | **Yes (keep)** | No tokens | No |
| Isolated relay **tests** | Yes | **Yes (done)** | Possible, avoid Bitcoin host |
| Production relay | Dies with Alpha-down | Helps Alpha-down; **dies with Unraid** (same as Honcho) | More independent of both brains; shares house LAN; Bitcoin/load |
| Voting witness | No (is a brain) | No (same as Honcho/Bravo) | **Observer only** — same LAN, not a third power domain |

**Achievable now**
- Keep Alpha native Telegram/Discord/Matrix.
- Run isolated relay **tests** on Unraid without cutting over.
- Manual promote remains the only safe brain switch.
- Honcho dumps already off-host to UNAS.

**Unsafe / not claimed**
- Auto failover
- Charlie as independent quorum witness
- Production relay on Unraid **and** “Unraid can die without losing chat” (tokens would live on Bravo’s chassis)
- Production relay on Alpha (useless for Mini death)
- Two live connectors on one bot token

**Is more hardware necessary?**  
For **true** independent relay **and** witness **and** Honcho: **yes**. With these three, you cannot separate Unraid failure from Honcho+worker, and Charlie is not a safe voting witness. Extra hardware is **not** required to keep testing the proto on Unraid.

---

## Production vs prototype placement

- **Prototype:** Unraid `--network none` (done). May repeat. Do not publish ports. Do not bind Docker socket.
- **Production relay:** **do not cut over**. If later: Charlie is the least-bad of the three for *chat* surviving Unraid **or** Mini — but only if Bitcoin/Umbrel risk is accepted and tokens leave Alpha. Until then Alpha keeps pollers.

Single relay = SPOF. Active/passive two relays need exclusive token ownership (same as brains).

---

## Auto failover

**Disabled.**

Stop after 5D.
