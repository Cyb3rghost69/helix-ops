# Helix OS Dual-Brain HA V2 — Phase 5G

Date: 2026-10-20 AEDT.
No production restarts, no Hermes core patches, no token migration, no auto failover, no Git push, no live Matrix bot create.

Live: Alpha **0.22.2** Telegram/Discord/Matrix (`@hermes:m.kickdead.com`); Bravo worker; Honcho 200; Ops 200.

---

## Relay (isolated)

Added dummy TG/Discord adapters, durable SQLite queue (dedup, retry/backoff, DLQ, expiry), fencing handover in e2e dummy test.

**Tests:** `python3 -m unittest` proto **40 OK**. Loopback real transport **2 OK** (LEVEL 2). LEVEL 3/4 **not** done.

Delivery: **at-most-once** inbound mid; stale epoch drop. **Not** exactly-once. Destructive actions not auto-retried (no such ops in proto).

Telegram/Discord **not** moved to relay.

---

## Matrix Main AI — **PLAN ONLY** (approval required)

Verified: `https://m.kickdead.com` well-known → same base_url. Native Hermes Matrix **enabled**. MXID **`@hermes:m.kickdead.com`**. `ALLOW_ALL_USERS=false`, `REQUIRE_MENTION=true`, E2EE **optional**. Home room configured (id not repeated here).

**Option A executed (display name only).** MXID still `@hermes:m.kickdead.com`. Homeserver profile `displayname` is **HELIX** (LAN Tuwunel GET after PUT 200). No new account. Token/rooms/Grok routing not changed.

**Receive/respond NOT verified.** After the 2026-10-19 gateway restart, logs show Matrix adapter creation **failed** (`extra 'matrix'` not installed on macOS in this venv). No live inbound since then. Do **not** claim HELIX Matrix chat works until you send a DM in Element **and** the Mac adapter is restored (needs extra install + Terminal `hermes gateway restart` — **not** done; needs a separate approval).

Do not merge private histories across Telegram/Matrix without explicit mapping.

---

## GitHub — **inventory, no new repo, no push**

Existing **private** `https://github.com/Cyb3rghost69/helix-ops` (`isPrivate: true`). Last remote push **2026-10-04**. Disposable clone to `~/.hermes/cache/scratch/helix-ops-clone-5g` succeeded; remote HEAD **`bfe9004`**, 42 files. Local ops-dashboard branch **`helix-medic`** at `640cb24`, **dirty**. History name-scan: `.env.example` only (placeholders). **Not** a complete Helix OS backup.

**Do not create `helix-os`.** Use `helix-ops` or you approve a new empty private repo.

**Not a complete Helix OS backup:** HA proto, phase reports, Matrix/relay code are **not** on that remote.

Secret scan of `ha-fence-proto` + 5x reports: **no** private-key/token patterns. Example gitignore: `ha-fence-proto/gitignore-helix-os.example`.

**Awaiting approval to:** commit **reviewed** source (ops + proto + docs, no `.env`) to `helix-ops` on a branch, push **without force**. Unattended daily commit **not** enabled.

---

## Ops previews (not production routes)

`ha-fence-proto/preview-5g.html` — MAIN AI / GITHUB / RELAY labels. SIM.

---

## Verification levels

1. Simulation: 43 OK  
2. Real Hermes WS transport: 2 OK  
3. Isolated real TG/Discord/Matrix bots: **no**  
4. Production: **no**

---

## Approval needed (stop)

1. Matrix: **A** rename `@hermes` display to HELIX, or **B** new `@helix` (not both).  
2. GitHub: confirm **helix-ops** (not new helix-os) and allow a **reviewed** first push of listed paths.  
3. Do **not** enable unattended git writers yet.

## 5H (after approval)

Execute only the chosen Matrix + GitHub actions. Still no auto failover.

Stop after 5G.
