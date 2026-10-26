"""HELIX/OPS accounts — users, roles, password hashing, sessions, lockouts, audit.

Passwords are never stored: only a salted scrypt hash (PBKDF2-SHA256 fallback when the
Python build has no scrypt). Users live in helix-users.json (chmod 600, gitignored);
the audit trail in helix-auth-audit.jsonl. Sessions are random 256-bit tokens kept in
memory only, indexed by their SHA-256 so the store never holds a usable cookie.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
USERS_FILE = ROOT / "helix-users.json"
AUDIT_FILE = ROOT / "helix-auth-audit.jsonl"
OPS_ENV = ROOT / "ops.env"

ROLES = ("admin", "operator", "viewer")
ROLE_INFO = {
    "admin": "everything, including users and sessions",
    "operator": "use the dashboard: chat, lights, actions",
    "viewer": "read-only",
}
USER_RX = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,31}$")
IDLE_TTL = 12 * 3600          # sign out after 12 h without activity
ABS_TTL = 7 * 86400           # and always after 7 days
MAX_FAILS_IP = 5              # failures per IP inside the window → lock
MAX_FAILS_USER = 10           # failures per username inside the window → lock
FAIL_WINDOW = 15 * 60
LOCK_SECONDS = 15 * 60
MIN_PW = 10
COMMON = {"password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "letmein123",
          "iloveyou1", "admin1234", "helixhelix", "changeme123", "welcome123", "qwertyuiop", "passw0rd", "abc123456"}

_LOCK = threading.RLock()
_SESSIONS: dict[str, dict] = {}       # sha256(token) → record
_FAILS: dict[str, list[float]] = {}   # "ip:x" / "user:x" → failure times
_LOCKS: dict[str, float] = {}         # same keys → locked until
_PWCHANGE: dict[str, dict] = {}       # sha256(one-time token) → {user, exp}

# ───────── password hashing ─────────
SCRYPT = {"n": 2 ** 15, "r": 8, "p": 1}
PBKDF2_ITERS = 600_000


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    try:
        dk = hashlib.scrypt(pw.encode("utf-8"), salt=salt, n=SCRYPT["n"], r=SCRYPT["r"], p=SCRYPT["p"], maxmem=64 * 1024 * 1024, dklen=32)
        return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${_b64(salt)}${_b64(dk)}"
    except (AttributeError, ValueError):
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, PBKDF2_ITERS)
        return f"pbkdf2_sha256${PBKDF2_ITERS}${_b64(salt)}${_b64(dk)}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if parts[0] == "scrypt":
            n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
            salt, want = base64.b64decode(parts[4]), base64.b64decode(parts[5])
            got = hashlib.scrypt(pw.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=64 * 1024 * 1024, dklen=len(want))
        elif parts[0] == "pbkdf2_sha256":
            it, salt, want = int(parts[1]), base64.b64decode(parts[2]), base64.b64decode(parts[3])
            got = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, it)
        else:
            return False
        return hmac.compare_digest(got, want)
    except (ValueError, IndexError, TypeError, AttributeError):
        return False


def needs_rehash(stored: str) -> bool:
    try:
        s = stored.split("$")
        if s[0] == "scrypt":
            return int(s[1]) < SCRYPT["n"]
        return hasattr(hashlib, "scrypt") or int(s[1]) < PBKDF2_ITERS
    except (ValueError, IndexError):
        return True


_DUMMY = None


def _dummy_hash() -> str:
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password(secrets.token_urlsafe(16))
    return _DUMMY


def password_problem(pw: str, username: str = "") -> str | None:
    if len(pw) < MIN_PW:
        return f"PASSWORD TOO SHORT ({MIN_PW}+ CHARACTERS)"
    if len(pw) > 256:
        return "PASSWORD TOO LONG"
    low = pw.lower()
    if low in COMMON or (username and username.lower() in low):
        return "PASSWORD TOO EASY TO GUESS"
    if len(set(pw)) < 4:
        return "PASSWORD TOO SIMPLE"
    return None


def gen_password() -> str:
    words = ["neon", "pixel", "comet", "orbit", "glitch", "byte", "laser", "nova", "turbo", "arcade", "vapor", "quartz", "echo", "cobalt", "ember", "drift"]
    return "-".join(secrets.choice(words) for _ in range(3)) + "-" + str(secrets.randbelow(900) + 100)


# ───────── store ─────────
def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _load() -> dict:
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("users"), list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"users": []}


def _save(data: dict) -> None:
    tmp = USERS_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, USERS_FILE)
    try:
        os.chmod(USERS_FILE, 0o600)
    except OSError:
        pass


def _find(data: dict, username: str) -> dict | None:
    u = (username or "").strip().lower()
    return next((x for x in data["users"] if x.get("username") == u), None)


def audit(event: str, user: str = "", ip: str = "", **detail) -> None:
    rec = {"t": _now(), "event": event, "user": user, "ip": ip}
    rec.update({k: v for k, v in detail.items() if v is not None})
    try:
        fd = os.open(AUDIT_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass


def audit_tail(limit: int = 200) -> list[dict]:
    try:
        lines = AUDIT_FILE.read_text(encoding="utf-8").splitlines()[-max(1, min(limit, 1000)):]
    except OSError:
        return []
    out = []
    for ln in reversed(lines):
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


# ───────── migration from the old plaintext ops.env password ─────────
def _parse_env(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def migrate() -> None:
    """Move HELIX_OPS_PASSWORD out of ops.env into a hashed admin account; keeps every other line."""
    with _LOCK:
        if not OPS_ENV.is_file():
            return
        text = OPS_ENV.read_text(encoding="utf-8")
        env = _parse_env(text)
        pw = env.get("HELIX_OPS_PASSWORD") or ""
        data = _load()
        if pw and not data["users"]:
            name = (env.get("HELIX_OPS_USER") or "helix").strip().lower()
            if not USER_RX.match(name):
                name = "helix"
            data["users"].append({"username": name, "role": "admin", "hash": hash_password(pw), "created": _now(), "must_change": False, "disabled": False, "note": "migrated from ops.env"})
            _save(data)
            audit("migrated", name, note="plaintext password moved from ops.env to a hashed account")
        if "HELIX_OPS_PASSWORD" in env or (env.get("HELIX_OPS_SETUP") or "") == "1":
            keep = [ln for ln in text.splitlines() if not re.match(r"\s*(HELIX_OPS_PASSWORD|HELIX_OPS_SETUP)\s*=", ln)]
            fd = os.open(OPS_ENV.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("\n".join(keep).rstrip("\n") + "\n")
            os.replace(OPS_ENV.with_suffix(".tmp"), OPS_ENV)
            try:
                os.chmod(OPS_ENV, 0o600)
            except OSError:
                pass


def setup_needed() -> bool:
    with _LOCK:
        return not any(u.get("role") == "admin" and not u.get("disabled") for u in _load()["users"])


# ───────── lockouts ─────────
def _prune(key: str, now: float) -> list[float]:
    arr = [t for t in _FAILS.get(key, []) if now - t < FAIL_WINDOW]
    _FAILS[key] = arr
    return arr


def locked(ip: str, username: str = "") -> int:
    """Seconds left on a lock for this IP or username (0 = not locked)."""
    now = time.time()
    with _LOCK:
        left = max(_LOCKS.get("ip:" + ip, 0), _LOCKS.get("user:" + (username or "").lower(), 0) if username else 0) - now
        return int(left) if left > 0 else 0


def _fail(ip: str, username: str) -> None:
    now = time.time()
    with _LOCK:
        for key, cap in (("ip:" + ip, MAX_FAILS_IP), ("user:" + (username or "").lower(), MAX_FAILS_USER)):
            if key == "user:":
                continue
            arr = _prune(key, now)
            arr.append(now)
            if len(arr) >= cap:
                _LOCKS[key] = now + LOCK_SECONDS
                audit("locked", username, ip, scope=key.split(":")[0], minutes=LOCK_SECONDS // 60)


def lockouts() -> list[dict]:
    now = time.time()
    with _LOCK:
        return [{"key": k, "scope": k.split(":", 1)[0], "who": k.split(":", 1)[1], "seconds": int(v - now)} for k, v in _LOCKS.items() if v > now]


def unlock(key: str) -> None:
    with _LOCK:
        _LOCKS.pop(key, None)
        _FAILS.pop(key, None)


# ───────── login / sessions ─────────
def _h(tok: str) -> str:
    return hashlib.sha256(tok.encode("utf-8")).hexdigest()


def login(username: str, password: str, ip: str, ua: str = "") -> dict:
    """→ {ok, token?, must_change?, change_token?, error?, wait?}"""
    username = (username or "").strip().lower()[:64]
    wait = locked(ip, username)
    if wait:
        audit("login_blocked", username, ip, seconds=wait)
        return {"ok": False, "error": "locked", "wait": wait}
    with _LOCK:
        u = _find(_load(), username)
    stored = (u or {}).get("hash") or _dummy_hash()          # same work for unknown users (no timing leak)
    good = verify_password(password or "", stored) and u is not None and not u.get("disabled")
    if not good:
        _fail(ip, username)
        audit("login_failed", username, ip, reason="disabled" if u and u.get("disabled") else "bad credentials")
        return {"ok": False, "error": "denied"}
    with _LOCK:
        _FAILS.pop("ip:" + ip, None)
        _FAILS.pop("user:" + username, None)
        data = _load()
        u = _find(data, username)
        if needs_rehash(u["hash"]):
            u["hash"] = hash_password(password)
        u["last_login"] = _now()
        u["last_ip"] = ip
        _save(data)
        if u.get("must_change"):
            tok = secrets.token_urlsafe(32)
            _PWCHANGE[_h(tok)] = {"user": username, "exp": time.time() + 600}
            audit("login_must_change", username, ip)
            return {"ok": True, "must_change": True, "change_token": tok}
    audit("login", username, ip)
    return {"ok": True, "token": new_session(username, u["role"], ip, ua)}


def complete_change(change_token: str, new_pw: str, ip: str, ua: str = "") -> dict:
    with _LOCK:
        rec = _PWCHANGE.get(_h(change_token or ""))
        if not rec or rec["exp"] < time.time():
            _PWCHANGE.pop(_h(change_token or ""), None)
            return {"ok": False, "error": "EXPIRED — LOG IN AGAIN"}
        prob = password_problem(new_pw, rec["user"])
        if prob:
            return {"ok": False, "error": prob}
        data = _load()
        u = _find(data, rec["user"])
        if not u or u.get("disabled"):
            return {"ok": False, "error": "ACCOUNT UNAVAILABLE"}
        if verify_password(new_pw, u["hash"]):
            return {"ok": False, "error": "CHOOSE A NEW PASSWORD"}
        u["hash"] = hash_password(new_pw)
        u["must_change"] = False
        u["pw_changed"] = _now()
        _save(data)
        _PWCHANGE.pop(_h(change_token), None)
    audit("password_changed", rec["user"], ip, via="first login")
    return {"ok": True, "token": new_session(rec["user"], u["role"], ip, ua)}


def setup_first_admin(username: str, pw: str, ip: str, ua: str = "") -> dict:
    username = (username or "").strip().lower()
    if not USER_RX.match(username):
        return {"ok": False, "error": "USERNAME: 2–32 LOWERCASE LETTERS, DIGITS, . _ -"}
    prob = password_problem(pw, username)
    if prob:
        return {"ok": False, "error": prob}
    with _LOCK:
        if not setup_needed():
            return {"ok": False, "error": "ALREADY SET UP"}
        data = _load()
        data["users"].append({"username": username, "role": "admin", "hash": hash_password(pw), "created": _now(), "must_change": False, "disabled": False})
        _save(data)
    audit("setup", username, ip, note="first admin created")
    return {"ok": True, "token": new_session(username, "admin", ip, ua)}


def new_session(user: str, role: str, ip: str = "", ua: str = "") -> str:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    with _LOCK:
        _SESSIONS[_h(tok)] = {"user": user, "role": role, "created": now, "seen": now, "ip": ip, "ua": (ua or "")[:160]}
    return tok


def session(tok: str | None) -> dict | None:
    if not tok:
        return None
    now = time.time()
    k = _h(tok)
    with _LOCK:
        rec = _SESSIONS.get(k)
        if not rec:
            return None
        if now - rec["seen"] > IDLE_TTL or now - rec["created"] > ABS_TTL:
            _SESSIONS.pop(k, None)
            return None
        rec["seen"] = now
        return {**rec, "sid": k[:12]}


def drop_session(tok: str | None) -> None:
    if tok:
        with _LOCK:
            _SESSIONS.pop(_h(tok), None)


def revoke_user(username: str) -> int:
    with _LOCK:
        ks = [k for k, v in _SESSIONS.items() if v["user"] == username]
        for k in ks:
            _SESSIONS.pop(k, None)
        return len(ks)


def sessions_list() -> list[dict]:
    now = time.time()
    with _LOCK:
        return [{"sid": k[:12], "user": v["user"], "role": v["role"], "ip": v["ip"], "ua": v["ua"], "created": int(v["created"]), "seen": int(v["seen"]), "idle_s": int(now - v["seen"])}
                for k, v in sorted(_SESSIONS.items(), key=lambda kv: -kv[1]["seen"])]


def revoke_sid(sid: str) -> bool:
    with _LOCK:
        k = next((k for k in _SESSIONS if k[:12] == sid), None)
        if k:
            _SESSIONS.pop(k, None)
        return bool(k)


# ───────── self service + admin ─────────
def change_own_password(username: str, current: str, new: str, ip: str, keep_sid: str = "") -> dict:
    wait = locked(ip, username)
    if wait:
        return {"ok": False, "error": f"too many attempts — wait {wait // 60 + 1} min"}
    with _LOCK:
        data = _load()
        u = _find(data, username)
        if not u or not verify_password(current or "", u["hash"]):
            _fail(ip, username)
            audit("password_change_failed", username, ip)
            return {"ok": False, "error": "current password is wrong"}
        prob = password_problem(new or "", username)
        if prob:
            return {"ok": False, "error": prob.lower()}
        u["hash"] = hash_password(new)
        u["pw_changed"] = _now()
        _save(data)
        # sign out every other session of this user
        for k in [k for k, v in _SESSIONS.items() if v["user"] == username and k[:12] != keep_sid]:
            _SESSIONS.pop(k, None)
    audit("password_changed", username, ip, via="account page")
    return {"ok": True}


def public_users() -> list[dict]:
    with _LOCK:
        data = _load()
        live = {}
        for v in _SESSIONS.values():
            live[v["user"]] = live.get(v["user"], 0) + 1
        return [{k: u.get(k) for k in ("username", "role", "created", "last_login", "last_ip", "disabled", "must_change", "pw_changed", "note")} | {"sessions": live.get(u["username"], 0)} for u in data["users"]]


def admin_act(actor: str, ip: str, data: dict) -> dict:
    action = str(data.get("action") or "")
    name = str(data.get("username") or "").strip().lower()
    out: dict = {"ok": True}
    with _LOCK:
        store = _load()
        admins = [u for u in store["users"] if u.get("role") == "admin" and not u.get("disabled")]
        u = _find(store, name)

        def last_admin(target: dict) -> bool:
            return target.get("role") == "admin" and not target.get("disabled") and len(admins) <= 1

        if action == "add":
            role = str(data.get("role") or "viewer")
            if not USER_RX.match(name):
                return {"ok": False, "error": "username: 2–32 lowercase letters, digits, . _ -"}
            if u:
                return {"ok": False, "error": "that username already exists"}
            if role not in ROLES:
                return {"ok": False, "error": "bad role"}
            pw = str(data.get("password") or "")
            temp = not pw
            if temp:
                pw = gen_password()
            else:
                prob = password_problem(pw, name)
                if prob:
                    return {"ok": False, "error": prob.lower()}
            store["users"].append({"username": name, "role": role, "hash": hash_password(pw), "created": _now(), "must_change": temp or bool(data.get("must_change", True)), "disabled": False, "created_by": actor})
            _save(store)
            audit("user_added", actor, ip, target=name, role=role)
            if temp:
                out["temp_password"] = pw
        elif not u:
            return {"ok": False, "error": "no such user"}
        elif action == "delete":
            if name == actor:
                return {"ok": False, "error": "you can't delete your own account"}
            if last_admin(u):
                return {"ok": False, "error": "can't remove the last admin"}
            store["users"] = [x for x in store["users"] if x["username"] != name]
            _save(store)
            revoke_user(name)
            audit("user_deleted", actor, ip, target=name)
        elif action == "role":
            role = str(data.get("role") or "")
            if role not in ROLES:
                return {"ok": False, "error": "bad role"}
            if role != "admin" and last_admin(u):
                return {"ok": False, "error": "can't demote the last admin"}
            u["role"] = role
            _save(store)
            for v in _SESSIONS.values():
                if v["user"] == name:
                    v["role"] = role
            audit("role_changed", actor, ip, target=name, role=role)
        elif action in ("disable", "enable"):
            if action == "disable" and name == actor:
                return {"ok": False, "error": "you can't disable your own account"}
            if action == "disable" and last_admin(u):
                return {"ok": False, "error": "can't disable the last admin"}
            u["disabled"] = action == "disable"
            _save(store)
            if action == "disable":
                revoke_user(name)
            audit("user_" + action + "d", actor, ip, target=name)
        elif action == "reset":
            pw = gen_password()
            u["hash"] = hash_password(pw)
            u["must_change"] = True
            _save(store)
            revoke_user(name)
            unlock("user:" + name)
            audit("password_reset", actor, ip, target=name)
            out["temp_password"] = pw
        elif action == "logout":
            n = revoke_user(name)
            audit("sessions_revoked", actor, ip, target=name, count=n)
            out["revoked"] = n
        else:
            return {"ok": False, "error": "unknown action"}
    return out
