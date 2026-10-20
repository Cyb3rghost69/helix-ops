# helix-ops backup readiness (Phase 5G Option A follow-up)

Remote: https://github.com/Cyb3rghost69/helix-ops **private**
HEAD: `bfe9004` (pushed 2026-10-04). Local ops-dashboard: branch `helix-medic`, **dirty**. **No commit. No push.** Unattended git **off**.

## Include (proposed)

Helix Ops (`~/.hermes/reports/ops-dashboard/`): ~70 dirty/untracked source files — `server.py`, `index.html`, themes/js/css, BRAINS/HA overlay, plist, docs/*.md, tests. **Include** `.env.example` (placeholders). **Include** `helix-avatar-base.jpg` only if you still want that asset on GitHub (personal photo).

Relay proto (`ha-fence-proto/`): `*.py` tests + `preview*.html` + `gitignore-helix-os.example`.

Reports: `helix-ha-v2-phase1.md` … `phase5g.md`.

## Exclude

- production `.env`, `ops.env`, tokens, keys
- `comms-hist.json` (chat history)
- Honcho dumps / SQLite / live DBs
- Bitcoin / NAS / Unraid flash secrets
- unattended git writers

## Secret scan

No private-key / `ghp_` / Matrix token **values** in proto or phase reports. Identifier mentions of `MATRIX_ACCESS_TOKEN` in code/docs only. Remote history: `.env.example` only.

## Proposed commit (not applied)

`docs: Helix OS source snapshot — ops dashboard, HA/relay proto, phase reports`

**Awaiting push approval.** Do not force-push.
