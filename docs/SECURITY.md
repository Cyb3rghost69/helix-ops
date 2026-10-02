# Security

- Repository is **private**. Do not make it public without an explicit operator order.
- Never commit `ops.env`, `unifi.env`, `~/.hermes/.env`, SSH private keys, or RustDesk `id_ed25519` / `RustDesk.toml`.
- Do not print secrets in Telegram, logs, or dashboard JSON.
- `/api/remote` must not include passwords or peer public-key blobs.
- `/api/adze` must not include OpenAI keys.
- Login cookie is HttpOnly. Testing `HELIX_OPS_AUTH=off` is temporary.
- Force-push, `git reset --hard`, and `git clean -fd` require explicit operator authorization.
