# Security

- Repository is **private**. Do not make it public without an explicit operator order.
- Never commit `ops.env`, `unifi.env`, `~/.hermes/.env`, SSH private keys, or RustDesk `id_ed25519` / `RustDesk.toml`.
- Do not print secrets in Telegram, logs, or dashboard JSON.
- `/api/remote` must not include passwords or peer public-key blobs.
- `/api/adze` must not include OpenAI keys.
- Login cookie is HttpOnly. Testing `HELIX_OPS_AUTH=off` is temporary.
- Force-push, `git reset --hard`, and `git clean -fd` require explicit operator authorization.

## Accounts & login

### Accounts
- Users live in `helix-users.json` next to `server.py` (chmod 600, gitignored). Passwords are **never stored** — only a salted **scrypt** hash (N=32768, r=8, p=1; PBKDF2-SHA256 × 600k if this Python has no scrypt). Old hashes are upgraded on the next sign-in.
- Roles: **admin** (everything, incl. ADMIN page), **operator** (use the dashboard: chat, lights, actions), **viewer** (read-only — every POST is refused with 403).
- First run (no admin yet): the login page becomes **FIRST RUN** and creates the first admin.
- Upgrading from the old single login: on start the server moves `HELIX_OPS_PASSWORD` from `ops.env` into a hashed **admin** account (same username/password) and deletes that line. All other `ops.env` settings are kept.
- Locked out / forgot it: on the Mac run `python3 helix_auth.py reset-admin` in the dashboard folder. It sets **admin / admin** as a temporary login that must be changed at the first sign-in (`reset-admin <user> <temp-password>` for other values). Rename the account afterwards on ADMIN → USERS → RENAME.
- Temporary passwords (new users, resets) are shown to the admin once and must be replaced at first sign-in.

### ADMIN page (`#/admin`)
USERS (add, role, reset password, sign out everywhere, disable/enable, delete — you can't delete/disable/demote yourself or the last admin) · SESSIONS (every signed-in device, revoke) · SECURITY LOG (sign-ins, failures, lockouts, admin changes from `helix-auth-audit.jsonl`) · SECURITY (lockouts with UNLOCK, active protections) · MY ACCOUNT (change password — signs out your other devices). Non-admins only see MY ACCOUNT.

### Protections
| Threat | Defence |
|---|---|
| Stolen user file | salted scrypt hashes, file is 600 |
| Password guessing | 5 failures per address or 10 per username in 15 min → 15 min lock; same work for unknown users (no username probing) |
| Session theft | 256-bit random cookie, `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS; server keeps only its SHA-256; 12 h idle / 7 day max; revoked on password change, reset, disable, delete |
| CSRF | every POST must come from the same origin (Origin/Referer check), plus SameSite cookies |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, HSTS on HTTPS |
| Weak passwords | 10+ characters, not common, not containing the username |
| Leaks | passwords never logged or put in the audit log; secrets stay in ops.env / helix-users.json (both gitignored) |

`HELIX_OPS_AUTH=off` in `ops.env` disables login entirely (everyone is admin) — only for local testing. Always use the Tailscale **HTTPS** address from other devices.

### API
`GET /api/me` · `POST /api/me/password {current,new}` · `GET /api/admin` · `POST /api/admin {action: add|delete|role|disable|enable|reset|logout|revoke_session|unlock, ...}` (admin only).
