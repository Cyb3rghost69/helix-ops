"""DATA VAULT SMART — Mac host only. Omit unsupported attributes."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _run(cmd: list[str], timeout: float = 4) -> str:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (p.stdout or "") + (p.stderr or "")


def _diskutil_info(disk: str = "disk0") -> dict:
    text = _run(["/usr/sbin/diskutil", "info", disk])
    def grab(label: str) -> str | None:
        m = re.search(rf"{re.escape(label)}:\s+(.+)$", text, re.M)
        return m.group(1).strip() if m else None
    smart = grab("SMART Status")
    model = grab("Device / Media Name")
    node = grab("Device Node")
    proto = grab("Protocol")
    size = grab("Disk Size") or grab("Total Size")
    ssd = grab("Solid State")
    cap_b = None
    if size:
        m = re.search(r"\((\d+)\s+Bytes\)", size, re.I)
        if m:
            cap_b = int(m.group(1))
    status = None
    if smart:
        sl = smart.lower()
        if sl == "verified":
            status = "OK"
        elif "fail" in sl:
            status = "FAIL"
        else:
            status = smart.upper()
    return {
        "id": "NVME-01",
        "device": node or "/dev/disk0",
        "model": model,
        "protocol": proto,
        "solidState": ssd == "Yes" if ssd else None,
        "capacityBytes": cap_b,
        "capacity": size.split("(")[0].strip() if size else None,
        "smart": status,
        "smartRaw": smart,
        "temperatureC": None,
        "powerOnHours": None,
        "wear": None,
        "reallocated": None,
        "pending": None,
        "mediaErrors": None,
        "pctUsed": None,
        "availableSpare": None,
        "quality": "LIVE" if smart else "UNAVAILABLE",
    }


def _df_root() -> dict:
    text = _run(["/bin/df", "-k", "/"])
    lines = text.splitlines()
    if len(lines) < 2:
        return {}
    cols = lines[-1].split()
    if len(cols) < 5:
        return {}
    try:
        used = round(int(cols[2]) / 1048576, 1)
        avail = round(int(cols[3]) / 1048576, 1)
        pct = cols[4]
    except ValueError:
        return {}
    return {"usedGb": used, "availGb": avail, "pct": pct}


def snapshot() -> dict:
    d0 = _diskutil_info("disk0")
    space = _df_root()
    drives = []
    if d0.get("model") or d0.get("smart"):
        drives.append(d0)
    attention = [d for d in drives if d.get("smart") and d["smart"] not in ("OK", "VERIFIED")]
    return {
        "ok": bool(drives),
        "host": "mac",
        "t": time.time(),
        "quality": "LIVE" if drives else "UNAVAILABLE",
        "space": space,
        "drives": drives,
        "attention": attention,
        "note": "Apple NVMe exposes SMART overall only; vendor counters require smartctl (not installed).",
        "unraid": None,
    }
