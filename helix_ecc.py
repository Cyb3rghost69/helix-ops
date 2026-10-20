"""HELIX ECC — sanitised status for the silent hermes profile `ecc`.

Does not dump .env, tokens, or AGENTS.md. Does not install or enable hooks.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

HOME = Path.home()
VENDOR = HOME / ".hermes" / "vendor" / "ecc"
PROFILE = HOME / ".hermes" / "profiles" / "ecc"
CLI = HOME / ".local" / "bin" / "ecc-universal"


def _count_skills(root: Path) -> int:
    if not root.is_dir():
        return 0
    return sum(1 for p in root.rglob("SKILL.md") if p.is_file())


def snapshot() -> dict:
    ver = ""
    vp = VENDOR / "VERSION"
    if vp.is_file():
        ver = vp.read_text(encoding="utf-8", errors="replace").strip()[:16]
    skills = _count_skills(PROFILE / "skills")
    agents = 0
    ad = PROFILE / "agents"
    if ad.is_dir():
        agents = sum(1 for p in ad.iterdir() if p.is_file() or p.is_dir())
    commands = 0
    cd = PROFILE / "commands"
    if cd.is_dir():
        commands = sum(1 for p in cd.rglob("*") if p.is_file())
    sec = (PROFILE / "skills" / "security-scan" / "SKILL.md").is_file()
    return {
        "ok": True,
        "profile": "ecc",
        "telegram": False,
        "version": ver or "unknown",
        "vendor": str(VENDOR) if VENDOR.is_dir() else "",
        "cli": CLI.is_file() or bool(os.environ.get("ECC_UNIVERSAL")),
        "alias": "hermes-ecc",
        "skills": skills,
        "agents": agents,
        "commands": commands,
        "security_pack": sec,
        "hooks": False,
        "memory": "honcho",
        "note": "Silent profile. Helix Telegram stays default. Honcho stays memory.",
    }


def consult(query: str) -> dict:
    q = (query or "").strip()[:400]
    if not q:
        return {"ok": False, "error": "empty query"}
    bin_path = str(CLI) if CLI.is_file() else "ecc-universal"
    script = VENDOR / "scripts" / "ecc.js"
    if script.is_file():
        cmd = ["node", str(script), "consult", q, "--target", "hermes"]
    else:
        cmd = [bin_path, "consult", q, "--target", "hermes"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=25,
            cwd=str(VENDOR) if VENDOR.is_dir() else None,
        )
    except FileNotFoundError:
        return {"ok": False, "error": "ecc cli missing"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "consult timeout"}
    out = (proc.stdout or "")[-4000:]
    err = (proc.stderr or "")[-400:]
    return {
        "ok": proc.returncode == 0,
        "query": q,
        "text": out or err or "no output",
        "code": proc.returncode,
    }


def dispatch(message: str) -> dict:
    """One-shot hermes-ecc chat. No Telegram. Timeout bounded."""
    msg = (message or "").strip()[:800]
    if not msg:
        return {"ok": False, "error": "empty message"}
    alias = HOME / ".local" / "bin" / "hermes-ecc"
    cmd = [str(alias) if alias.is_file() else "hermes", "-p", "ecc", "chat", "-q", msg]
    if alias.is_file():
        cmd = [str(alias), "chat", "-q", msg]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except FileNotFoundError:
        return {"ok": False, "error": "hermes-ecc missing"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "ecc chat timeout"}
    text = (proc.stdout or proc.stderr or "")[-6000:]
    return {"ok": proc.returncode == 0, "text": text, "code": proc.returncode}
