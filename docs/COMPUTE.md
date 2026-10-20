# HELIX COMPUTE

Routing layer on Helix ops. Hermes Agent itself stays on the Mac.

## Targets

| Target | Use |
|---|---|
| MAC | Helix/Hermes self-care, voice, latency, small ops |
| UNRAID | Docker, logs, RAM/CPU-heavy, Python on Unraid Hermes peer |
| OLLAMA | cheap/private classify/summarise/embed |
| CLOUD | hard reasoning — still grok-4.6 / xai-oauth via Mac Hermes |

Canonical names: `auto` `mac` `unraid` `ollama` `cloud`.

- GET `/api/compute` — fleet CPU graph (unchanged)
- GET `/api/compute/status` — sanitised Mac/Unraid/Ollama/Honcho/Cloud + bigboi GPU 0–3
- POST `/api/compute/route` `{message, target, execute}`
- GET/POST `/api/hcompute` — legacy jobs + SSH recipes

AUTO is deterministic (keywords), not an extra LLM hop.
Unraid jobs use existing peer `http://192.168.1.84:8642` (not `/p/worker/`).
`restart Helix` is classified MAC and never executed.

## What this does **not** do

- Does **not** set Hermes `terminal.backend: ssh` (that would send every command to BigBoi).
- Does **not** move Hermes off the Mac.
- Does **not** start the `ollama` container (Tesla M10 fan load) without approval.
- Does **not** create a dedicated Unraid user (needs approval; SSH today is the existing key as `root`).
- Does **not** expose Ollama, Hermes API, or SSH keys to the browser.

## API

- GET `/api/hcompute` — telemetry + jobs (cookie auth)
- POST `/api/hcompute` `{action: snapshot|override|route|run}`

Fleet graph remains GET `/api/compute`.
