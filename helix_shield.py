"""HELIX/OPS — RAGNAR SHIELD.

Defensive LAN exposure audit for the TOKYO-06 deck. The check ideas are
ported from Ragnar (imperador/ragnar, Python 2 IoT pentest tool) and
rewritten for Python 3 stdlib, *non-destructive only*:

    netServ    → TCP connect sweep of a curated risky-port list + banner /
                 unauthenticated-service probes (Redis PING, Docker /version,
                 MQTT anonymous CONNECT, Elasticsearch /, memcached version)
    transCrypt → TLS negotiated protocol / cipher / bits, Perfect Forward
                 Secrecy, legacy TLS 1.0/1.1 acceptance, certificate expiry
    webI       → clickjacking headers (X-Frame-Options / CSP frame-ancestors),
                 login form or Basic auth over cleartext HTTP, HSTS, Server
                 version disclosure
    UniFi      → new-device detection against an operator baseline, UniFi
                 gear with firmware updates pending, IPS / alarm events

Not ported on purpose: SYN/HTTP floods (DDoS), SQL injection, XSS payloads,
directed fuzzing and the mrBin firmware module. They can brick IoT gear and
do not belong on an always-on dashboard. See docs/DECISIONS.md.

Scope guard: only private / loopback addresses inside SHIELD_SCOPE are ever
touched. No credentials are tried. No secrets are returned.
"""
from __future__ import annotations

import http.client
import ipaddress
import json
import os
import socket
import sqlite3
import ssl
import hmac
import sys
import tempfile
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("SHIELD_DATA") or ROOT)  # /data inside the Unraid container
DB = DATA / "shield.db"
BASELINE = DATA / "shield-baseline.json"

SEV_ORDER = {"high": 0, "med": 1, "low": 2, "info": 3}
SEV_COST = {"high": 15, "med": 6, "low": 2, "info": 0}

# port: (service, severity-if-open, note)
PORTS: dict[int, tuple[str, str, str]] = {
    21: ("ftp", "med", "Cleartext FTP — credentials cross the LAN unencrypted."),
    22: ("ssh", "info", "SSH listener."),
    23: ("telnet", "high", "Telnet is cleartext remote shell — classic IoT botnet entry (Mirai)."),
    25: ("smtp", "low", "SMTP listener on a LAN host."),
    53: ("dns", "info", "DNS resolver."),
    80: ("http", "info", "HTTP web interface."),
    139: ("netbios", "med", "NetBIOS session service — legacy Windows sharing."),
    443: ("https", "info", "HTTPS web interface."),
    445: ("smb", "med", "SMB file sharing — keep SMBv1 off, never expose past the LAN."),
    554: ("rtsp", "med", "RTSP camera stream — often unauthenticated on cheap IoT cams."),
    1883: ("mqtt", "med", "MQTT broker (cleartext). Anonymous access checked separately."),
    2375: ("docker", "high", "Docker Engine API without TLS — equals root on the host."),
    3306: ("mysql", "med", "MySQL reachable from the whole LAN."),
    3389: ("rdp", "med", "Remote Desktop listener."),
    5000: ("http-alt", "info", "Web interface (alt port)."),
    5001: ("https-alt", "info", "Web interface (alt TLS port)."),
    5432: ("postgres", "med", "PostgreSQL reachable from the whole LAN."),
    5900: ("vnc", "high", "VNC — frequently weak or no password, cleartext by default."),
    6379: ("redis", "med", "Redis reachable from the LAN. Auth checked separately."),
    7547: ("tr-069", "high", "TR-069/CWMP management port — ISP-style remote management."),
    8000: ("http-alt", "info", "Web interface (alt port)."),
    8006: ("proxmox", "info", "Proxmox / admin UI."),
    8080: ("http-proxy", "info", "Web interface (alt port)."),
    8081: ("http-alt", "info", "Web interface (alt port)."),
    8123: ("home-assistant", "info", "Home Assistant UI."),
    8443: ("https-alt", "info", "Web interface (alt TLS port)."),
    8888: ("http-alt", "info", "Web interface (alt port)."),
    9000: ("http-alt", "info", "Web interface (alt port, often Portainer)."),
    9100: ("jetdirect", "low", "Raw printer port — accepts print jobs from anyone on the LAN."),
    9200: ("elasticsearch", "med", "Elasticsearch HTTP API. Auth checked separately."),
    9443: ("https-alt", "info", "Web interface (alt TLS port)."),
    11211: ("memcached", "med", "memcached — no auth by design."),
    27017: ("mongodb", "med", "MongoDB reachable from the whole LAN."),
    32400: ("plex", "info", "Plex Media Server."),
}
WEB_PORTS = {80, 443, 5000, 5001, 8000, 8006, 8080, 8081, 8123, 8443, 8888, 9000, 9443, 32400}

def score_for(cost: int) -> int:
    """Hyperbolic so one bad host doesn't pin the dial at 0: cost 6→91, 15→80, 58→51, 150→29."""
    return int(round(100 / (1 + max(0, cost) / 60)))


def grade_for(score: int) -> str:
    return "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"


_LOCK = threading.Lock()
_STATE: dict = {"scanning": False, "phase": "IDLE", "done": 0, "total": 0, "started": None, "error": None}
_SCHED: dict = {"thread": None, "next": None}


# ───────────────────────── config / scope ─────────────────────────

def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def scope_nets() -> list[ipaddress._BaseNetwork]:
    raw = _env("SHIELD_SCOPE", "192.168.1.0/24")
    nets = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return nets


def in_scope(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if not (addr.is_private or addr.is_loopback):
        return False  # hard rule: never touch public addresses
    return any(addr in n for n in scope_nets())


def interval_h() -> float:
    try:
        return max(0.0, float(_env("SHIELD_INTERVAL_H", "6")))
    except ValueError:
        return 6.0


# ───────────────────────── storage ─────────────────────────

def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=5)
    con.execute(
        "CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, started REAL, finished REAL, score INTEGER, report TEXT)"
    )
    return con


def save_report(rep: dict) -> None:
    con = _db()
    try:
        con.execute(
            "INSERT INTO scans (started, finished, score, report) VALUES (?,?,?,?)",
            (rep["started"], rep["finished"], rep["score"], json.dumps(rep)),
        )
        con.execute("DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY id DESC LIMIT 60)")
        con.commit()
    finally:
        con.close()


def last_report() -> dict | None:
    if not DB.exists():
        return None
    con = _db()
    try:
        row = con.execute("SELECT report FROM scans ORDER BY id DESC LIMIT 1").fetchone()
    finally:
        con.close()
    return json.loads(row[0]) if row else None


def history(n: int = 30) -> list[dict]:
    if not DB.exists():
        return []
    con = _db()
    try:
        rows = con.execute("SELECT finished, score, report FROM scans ORDER BY id DESC LIMIT ?", (n,)).fetchall()
    finally:
        con.close()
    out = []
    for fin, score, rep in reversed(rows):
        c = (json.loads(rep).get("counts") or {}) if rep else {}
        out.append({"t": fin, "score": score, "high": c.get("high", 0), "med": c.get("med", 0), "low": c.get("low", 0)})
    return out


def load_baseline() -> dict:
    try:
        d = json.loads(BASELINE.read_text())
        if isinstance(d, dict):
            d.setdefault("devices", {})
            d.setdefault("muted", [])
            return d
    except (OSError, json.JSONDecodeError):
        pass
    return {"devices": {}, "muted": [], "seeded": None}


def save_baseline(b: dict) -> None:
    tmp = BASELINE.with_suffix(".tmp")
    tmp.write_text(json.dumps(b, indent=1, sort_keys=True))
    os.chmod(tmp, 0o600)
    tmp.replace(BASELINE)


def _dev_key(c: dict) -> str:
    return (c.get("mac") or "").lower() or f"ip:{c.get('ip') or ''}"


# ───────────────────────── netServ (ports + probes) ─────────────────────────

def tcp_open(ip: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def _talk(ip: str, port: int, payload: bytes | None, n: int = 256, timeout: float = 2.0) -> bytes:
    try:
        with socket.create_connection((ip, port), timeout=timeout) as s:
            s.settimeout(timeout)
            if payload:
                s.sendall(payload)
            return s.recv(n)
    except OSError:
        return b""


def probe_unauth(ip: str, port: int) -> dict | None:
    """Read-only checks that a service answers without credentials. Never writes."""
    svc = PORTS.get(port, ("", "", ""))[0]
    if svc == "redis":
        r = _talk(ip, port, b"PING\r\n")
        if r.startswith(b"+PONG"):
            return {"check": "redis-noauth", "sev": "high", "title": "Redis answers without a password",
                    "detail": "PING → +PONG with no AUTH. Anyone on the LAN can read/write keys."}
    elif svc == "docker":
        code, body = _http_get(ip, port, "/version", tls=False)
        if code == 200 and b"ApiVersion" in body:
            return {"check": "docker-noauth", "sev": "high", "title": "Docker API open without TLS/auth",
                    "detail": "GET /version answered. This is full root control of the host."}
    elif svc == "mqtt":
        # MQTT 3.1.1 CONNECT, clean session, client id "helix-shield", no username/password
        cid = b"helix-shield"
        var = b"\x00\x04MQTT\x04\x02\x00\x3c"
        pl = len(cid).to_bytes(2, "big") + cid
        pkt = b"\x10" + bytes([len(var) + len(pl)]) + var + pl
        r = _talk(ip, port, pkt, 4)
        if len(r) >= 4 and r[0] == 0x20 and r[3] == 0x00:
            return {"check": "mqtt-anon", "sev": "high", "title": "MQTT broker allows anonymous clients",
                    "detail": "CONNACK 0 with no credentials. Any LAN device can subscribe to # and publish commands."}
    elif svc == "elasticsearch":
        code, body = _http_get(ip, port, "/", tls=False)
        if code == 200 and b"cluster_name" in body:
            return {"check": "elastic-noauth", "sev": "high", "title": "Elasticsearch open without auth",
                    "detail": "GET / returned cluster info without credentials."}
    elif svc == "memcached":
        r = _talk(ip, port, b"version\r\n")
        if r.startswith(b"VERSION"):
            return {"check": "memcached-open", "sev": "med", "title": "memcached answering on LAN",
                    "detail": r.decode("ascii", "replace").strip()[:60]}
    elif svc == "ssh":
        r = _talk(ip, port, None, 128)
        line = r.split(b"\r\n")[0].decode("ascii", "replace")[:80]
        if line.startswith("SSH-1."):
            return {"check": "ssh-v1", "sev": "high", "title": "SSH protocol 1 offered", "detail": line}
        if line:
            return {"check": "ssh-banner", "sev": "info", "title": "SSH banner", "detail": line}
    return None


# ───────────────────────── transCrypt (TLS) ─────────────────────────

def _ctx(min_v=None, max_v=None, legacy_ok: bool = True) -> ssl.SSLContext:
    """Audit context: no verification, every cipher, and (by default) down to TLS 1.0 so
    legacy-only IoT gear is still identified as TLS rather than "not TLS"."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.set_ciphers("ALL:@SECLEVEL=0")
    except ssl.SSLError:
        pass
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        if min_v is None and legacy_ok:
            min_v = ssl.TLSVersion.TLSv1
        try:
            if min_v:
                ctx.minimum_version = min_v
            if max_v:
                ctx.maximum_version = max_v
        except (ValueError, ssl.SSLError):
            pass
    return ctx


def _handshake(ip: str, port: int, ctx: ssl.SSLContext, timeout: float = 3.0):
    raw = socket.create_connection((ip, port), timeout=timeout)
    raw.settimeout(timeout)
    try:
        return ctx.wrap_socket(raw, server_hostname=None)
    except Exception:
        raw.close()
        raise


def _decode_cert(der: bytes) -> dict:
    try:
        pem = ssl.DER_cert_to_PEM_cert(der)
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
            f.write(pem)
            path = f.name
        try:
            return ssl._ssl._test_decode_cert(path)  # stdlib, no extra deps
        finally:
            os.unlink(path)
    except Exception:
        return {}


def tls_audit(ip: str, port: int) -> dict | None:
    """None when the port does not speak TLS."""
    try:
        s = _handshake(ip, port, _ctx())
    except (OSError, ssl.SSLError, ValueError):
        return None
    try:
        proto = s.version() or "?"
        cname, _, bits = s.cipher() or ("?", "?", 0)
        der = s.getpeercert(binary_form=True) or b""
    finally:
        s.close()
    cert = _decode_cert(der) if der else {}
    pfs = proto == "TLSv1.3" or "DHE" in cname  # ECDHE-* and DHE-*
    out = {"tls": True, "protocol": proto, "cipher": cname, "bits": bits, "pfs": pfs, "legacy": None, "cert": None}
    # Ragnar transCrypt: does the server still accept TLS 1.0/1.1?
    try:
        ls = _handshake(ip, port, _ctx(ssl.TLSVersion.TLSv1, ssl.TLSVersion.TLSv1_1))
        out["legacy"] = ls.version()
        ls.close()
    except ssl.SSLError as e:
        msg = str(e).upper()
        out["legacy"] = "UNTESTABLE" if "NO_PROTOCOLS_AVAILABLE" in msg or "NO PROTOCOLS" in msg else False
    except (OSError, ValueError):
        out["legacy"] = False
    if cert:
        def flat(seq):
            return {k: v for rdn in seq or () for (k, v) in rdn}
        subj, iss = flat(cert.get("subject")), flat(cert.get("issuer"))
        exp = cert.get("notAfter")
        days = None
        if exp:
            try:
                days = int((ssl.cert_time_to_seconds(exp) - time.time()) // 86400)
            except ValueError:
                days = None
        out["cert"] = {
            "cn": subj.get("commonName") or "",
            "issuer": iss.get("commonName") or iss.get("organizationName") or "",
            "self_signed": bool(subj) and subj == iss,
            "expires": exp,
            "days_left": days,
        }
    return out


# ───────────────────────── webI (HTTP layer) ─────────────────────────

def _http_get(ip: str, port: int, path: str = "/", tls: bool = False, timeout: float = 3.0):
    try:
        if tls:
            conn = http.client.HTTPSConnection(ip, port, timeout=timeout, context=_ctx())
        else:
            conn = http.client.HTTPConnection(ip, port, timeout=timeout)
        conn.request("GET", path, headers={"User-Agent": "HELIX-OPS-Shield/1.0", "Accept": "*/*"})
        r = conn.getresponse()
        body = r.read(65536)
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        conn.close()
        return _pack(r.status, body, hdrs)
    except (OSError, http.client.HTTPException, ValueError):
        return _pack(0, b"", {})


class _Resp(tuple):
    """(status, body) tuple that also carries headers — keeps _http_get unpackable as 2-tuple."""
    headers: dict


def _pack(status: int, body: bytes, hdrs: dict):
    t = _Resp((status, body))
    t.headers = hdrs
    return t


def web_audit(ip: str, port: int, tls: bool) -> list[dict]:
    res = _http_get(ip, port, "/", tls=tls)
    code, body = res[0], res[1]
    if not code:
        return []
    h = getattr(res, "headers", {}) or {}
    out: list[dict] = []
    scheme = "https" if tls else "http"
    low = body.lower()
    is_html = b"<html" in low or "text/html" in h.get("content-type", "")
    has_pw = b'type="password"' in low or b"type='password'" in low or b"type=password" in low
    loc = h.get("location", "")
    if not tls:
        if code in (301, 302, 303, 307, 308) and loc.lower().startswith("https://"):
            out.append({"check": "http-redirect", "sev": "info", "title": "HTTP redirects to HTTPS", "detail": loc[:120]})
        else:
            if has_pw:
                out.append({"check": "login-cleartext", "sev": "high", "title": "Login form served over cleartext HTTP",
                            "detail": "Password field on http:// — credentials readable by anything on the LAN."})
            if code == 401 and "basic" in h.get("www-authenticate", "").lower():
                out.append({"check": "basic-cleartext", "sev": "high", "title": "HTTP Basic auth over cleartext",
                            "detail": "Basic credentials are only base64 — readable by anything on the LAN."})
    else:
        if code < 400 and "strict-transport-security" not in h:
            out.append({"check": "no-hsts", "sev": "low", "title": "No HSTS header", "detail": f"{scheme}://{ip}:{port}/"})
    if 200 <= code < 300 and is_html:
        xfo = h.get("x-frame-options", "").upper()
        csp = h.get("content-security-policy", "").lower()
        if xfo not in ("DENY", "SAMEORIGIN") and "frame-ancestors" not in csp:
            out.append({"check": "clickjack", "sev": "low", "title": "Clickjacking: no X-Frame-Options / frame-ancestors",
                        "detail": "UI can be framed by another page." + (" Has a login form." if has_pw else "")})
    server = h.get("server", "")
    if server and any(ch.isdigit() for ch in server):
        out.append({"check": "server-version", "sev": "info", "title": "Server version disclosed", "detail": server[:80]})
    title = ""
    i = low.find(b"<title")
    if i >= 0:
        j = low.find(b">", i)
        k = low.find(b"</title", j)
        if j > 0 and k > j:
            title = body[j + 1:k].decode("utf-8", "replace").strip()[:60]
    out.append({"check": "web-id", "sev": "info", "title": f"{scheme.upper()} {code}", "detail": title or h.get("content-type", "")[:40]})
    return out


# ───────────────────────── host audit ─────────────────────────

def audit_host(target: dict, ports: list[int] | None = None) -> dict:
    ip = target["ip"]
    ports = ports or sorted(PORTS)
    open_ports, checks = [], []
    for p in ports:
        if not tcp_open(ip, p):
            continue
        svc, sev, note = PORTS.get(p, ("tcp", "info", "Open TCP port."))
        row = {"port": p, "service": svc, "tls": None}
        checks.append({"check": f"port-{p}", "port": p, "sev": sev, "title": f"{p}/{svc} open", "detail": note})
        pr = probe_unauth(ip, p)
        if pr:
            pr["port"] = p
            if pr["sev"] in ("high", "med"):  # the specific finding supersedes "port open"
                checks[-1]["sev"] = "info"
            checks.append(pr)
        if p in WEB_PORTS or svc.startswith("http"):
            t = tls_audit(ip, p)
            row["tls"] = t
            if t:
                legacy_default = t["protocol"] in ("SSLv3", "TLSv1", "TLSv1.1")
                if legacy_default:
                    checks.append({"check": "tls-default-legacy", "port": p, "sev": "high",
                                   "title": f"Tops out at {t['protocol']} — no TLS 1.2+", "detail": t["cipher"]})
                elif t["legacy"] and t["legacy"] != "UNTESTABLE":
                    checks.append({"check": "tls-legacy", "port": p, "sev": "med",
                                   "title": f"Still accepts {t['legacy']}", "detail": "TLS 1.0/1.1 are deprecated (RFC 8996)."})
                if not t["pfs"]:
                    checks.append({"check": "tls-no-pfs", "port": p, "sev": "med",
                                   "title": "No Perfect Forward Secrecy", "detail": f"{t['protocol']} · {t['cipher']}"})
                if isinstance(t.get("bits"), int) and 0 < t["bits"] < 128:
                    checks.append({"check": "tls-weak", "port": p, "sev": "high",
                                   "title": f"Weak cipher ({t['bits']} bit)", "detail": t["cipher"]})
                c = t.get("cert") or {}
                if c.get("days_left") is not None:
                    if c["days_left"] < 0:
                        checks.append({"check": "cert-expired", "port": p, "sev": "med",
                                       "title": "Certificate expired", "detail": f"{c.get('cn')} · {c.get('expires')}"})
                    elif c["days_left"] < 21:
                        checks.append({"check": "cert-expiring", "port": p, "sev": "low",
                                       "title": f"Certificate expires in {c['days_left']}d", "detail": c.get("cn") or ""})
                if c.get("self_signed"):
                    checks.append({"check": "cert-self", "port": p, "sev": "info",
                                   "title": "Self-signed certificate", "detail": c.get("cn") or ""})
            for w in web_audit(ip, p, tls=bool(t)):
                w["port"] = p
                checks.append(w)
        open_ports.append(row)
    for c in checks:
        c["key"] = f"{ip}:{c.get('port', '')}:{c['check']}"
        c["ip"] = ip
        c["host"] = target.get("name") or target.get("hostname") or ip
    worst = min((SEV_ORDER[c["sev"]] for c in checks), default=4)
    return {
        "ip": ip,
        "name": target.get("name") or target.get("hostname") or "",
        "owner": target.get("owner") or "unknown",
        "mac": target.get("mac"),
        "vendor": target.get("vendor"),
        "open": open_ports,
        "checks": checks,
        "worst": [k for k, v in SEV_ORDER.items() if v == worst][0] if worst < 4 else "clean",
    }


# ───────────────────────── UniFi ─────────────────────────

def _unifi_req(base: str, key: str, path: str, body: dict | None = None, timeout: int = 8):
    ctx = ssl._create_unverified_context()  # UDM ships a self-signed cert
    data = json.dumps(body).encode() if body is not None else None
    req = Request(f"{base}{path}", data=data, headers={"X-API-KEY": key, "Accept": "application/json",
                                                       "Content-Type": "application/json"})
    with urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode() or "{}")


def unifi_intel(cfg: Callable[[], tuple[str | None, str]]) -> dict:
    key, base = cfg()
    out = {"ok": False, "error": None, "devices": [], "ips": [], "alarms": [], "ips_available": False}
    if not key:
        out["error"] = "no UniFi API key configured"
        return out
    errs = (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError)
    try:
        sites = _unifi_req(base, key, "/proxy/network/integration/v1/sites")
        data = sites.get("data") if isinstance(sites, dict) else sites
        site = data[0] if data else {}
        sid = site.get("id") or "default"
        sref = site.get("internalReference") or "default"
        devs = _unifi_req(base, key, f"/proxy/network/integration/v1/sites/{sid}/devices")
        for d in (devs.get("data") if isinstance(devs, dict) else []) or []:
            out["devices"].append({
                "name": d.get("name") or d.get("model") or "",
                "model": d.get("model") or "",
                "ip": d.get("ipAddress") or "",
                "state": d.get("state") or "",
                "firmware": d.get("firmwareVersion") or "",
                "updatable": bool(d.get("firmwareUpdatable")),
            })
        out["ok"] = True
    except errs as e:
        out["error"] = f"unifi: {type(e).__name__}"
        return out
    # Classic API — IPS/threat events + alarms. Not every UniFi OS build lets an
    # integration API key in here; absence is reported as NO TELEMETRY, not "clean".
    now = int(time.time() * 1000)
    try:
        ev = _unifi_req(base, key, f"/proxy/network/api/s/{sref}/stat/ips/event",
                        {"start": now - 86400000, "end": now, "_limit": 50})
        for e in (ev.get("data") if isinstance(ev, dict) else []) or []:
            out["ips"].append({
                "t": (e.get("timestamp") or e.get("time") or 0) / 1000 if (e.get("timestamp") or e.get("time")) else None,
                "src": e.get("src_ip") or "", "dst": e.get("dest_ip") or e.get("dst_ip") or "",
                "sig": (e.get("inner_alert_signature") or e.get("catname") or e.get("msg") or "")[:120],
                "action": e.get("inner_alert_action") or e.get("action") or "",
                "sev": e.get("inner_alert_severity"),
            })
        out["ips_available"] = True
    except errs:
        pass
    try:
        al = _unifi_req(base, key, f"/proxy/network/api/s/{sref}/stat/alarm?archived=false")
        for a in ((al.get("data") if isinstance(al, dict) else []) or [])[:30]:
            out["alarms"].append({"t": a.get("time", 0) / 1000 if a.get("time") else None,
                                  "key": a.get("key") or "", "msg": (a.get("msg") or "")[:140]})
    except errs:
        pass
    return out


# ───────────────────────── scan orchestration ─────────────────────────

def _set(**kw):
    with _LOCK:
        _STATE.update(kw)


def state() -> dict:
    with _LOCK:
        return dict(_STATE)


def run_scan(targets_fn: Callable[[], list[dict]], unifi_cfg: Callable, self_fn: Callable[[], list[dict]] | None = None,
             ports: list[int] | None = None) -> dict:
    t0 = time.time()
    _set(scanning=True, phase="DISCOVERY", done=0, total=0, started=t0, error=None)
    try:
        raw = targets_fn() or []
        seen, targets, skipped = set(), [], 0
        for t in raw:
            ip = str(t.get("ip") or "")
            if not ip or ip in seen:
                continue
            seen.add(ip)
            if in_scope(ip):
                targets.append(t)
            else:
                skipped += 1
        _set(phase="NETSERV · TRANSCRYPT · WEBI", total=len(targets))
        hosts: list[dict] = []

        def one(t):
            r = audit_host(t, ports)
            with _LOCK:
                _STATE["done"] += 1
            return r

        with ThreadPoolExecutor(max_workers=12) as pool:
            hosts = list(pool.map(one, targets))
        _set(phase="UNIFI")
        intel = unifi_intel(unifi_cfg)

        base = load_baseline()
        findings: list[dict] = []
        for h in hosts:
            findings.extend(c for c in h["checks"] if c["sev"] != "info")
        # new-device detection (UniFi + DNS client list vs operator baseline)
        devs = {(_dev_key(t)): t for t in raw if t.get("ip") or t.get("mac")}
        if not base.get("seeded"):
            base["devices"] = {k: {"name": v.get("name") or v.get("hostname") or "", "ip": v.get("ip") or "",
                                   "first": t0} for k, v in devs.items()}
            base["seeded"] = t0
            save_baseline(base)
            seeded_now = True
        else:
            seeded_now = False
        new_devices = []
        for k, v in devs.items():
            if k not in base["devices"]:
                nd = {"dev": k, "ip": v.get("ip") or "", "name": v.get("name") or v.get("hostname") or "",
                      "mac": v.get("mac"), "vendor": v.get("vendor"), "owner": v.get("owner") or "unknown",
                      "wired": v.get("wired"), "ssid": v.get("ssid")}
                new_devices.append(nd)
                findings.append({"key": f"dev:{k}", "check": "new-device", "sev": "med" if nd["owner"] == "unknown" else "low",
                                 "ip": nd["ip"], "host": nd["name"] or nd["ip"], "port": "",
                                 "title": "New device on the LAN",
                                 "detail": f"{nd['name'] or 'unnamed'} · {nd['mac'] or 'no mac'} · {nd['vendor'] or 'vendor ?'} — not in baseline"})
        for d in intel.get("devices", []):
            if d.get("updatable"):
                findings.append({"key": f"fw:{d['name']}", "check": "unifi-firmware", "sev": "med", "ip": d.get("ip", ""),
                                 "host": d["name"], "port": "", "title": "UniFi firmware update pending",
                                 "detail": f"{d['model']} on {d['firmware']}"})
        if intel.get("ips"):
            findings.append({"key": "unifi:ips", "check": "unifi-ips", "sev": "med", "ip": "", "host": "UniFi IPS", "port": "",
                             "title": f"{len(intel['ips'])} IPS events in 24h", "detail": intel["ips"][0].get("sig", "")})
        for f in (self_fn() if self_fn else []):
            findings.append(f)

        prev = last_report() or {}
        prev_keys = {f["key"] for f in prev.get("findings", [])}
        muted = set(base.get("muted") or [])
        for f in findings:
            f["new"] = bool(prev) and f["key"] not in prev_keys
            f["muted"] = f["key"] in muted
        findings.sort(key=lambda f: (f["muted"], SEV_ORDER[f["sev"]], f.get("ip") or "", str(f.get("port"))))
        live = [f for f in findings if not f["muted"]]
        counts = {s: sum(1 for f in live if f["sev"] == s) for s in ("high", "med", "low")}
        cost = sum(SEV_COST[f["sev"]] for f in live)
        score = score_for(cost)
        grade = grade_for(score)
        fixed = [k for k in prev_keys if k not in {f["key"] for f in findings}]
        rep = {
            "started": t0,
            "finished": time.time(),
            "ms": int((time.time() - t0) * 1000),
            "score": score,
            "cost": cost,
            "grade": grade,
            "counts": counts,
            "muted": sum(1 for f in findings if f["muted"]),
            "hosts": hosts,
            "skipped_out_of_scope": skipped,
            "findings": findings,
            "resolved": len(fixed),
            "new_devices": new_devices,
            "baseline_seeded_now": seeded_now,
            "unifi": intel,
            "ports_checked": len(ports or PORTS),
            "scope": [str(n) for n in scope_nets()],
        }
        save_report(rep)
        _set(scanning=False, phase="IDLE")
        return rep
    except Exception as e:  # keep the deck alive; surface the fault
        _set(scanning=False, phase="FAULT", error=f"{type(e).__name__}: {e}"[:200])
        raise


def start_scan(targets_fn, unifi_cfg, self_fn=None) -> bool:
    with _LOCK:
        if _STATE["scanning"]:
            return False
        _STATE["scanning"] = True
    def go():
        try:
            run_scan(targets_fn, unifi_cfg, self_fn)
        except Exception:
            pass
    threading.Thread(target=go, name="helix-shield", daemon=True).start()
    return True


def start_scheduler(targets_fn, unifi_cfg, self_fn=None) -> None:
    hrs = interval_h()
    if hrs <= 0 or _SCHED["thread"]:
        return

    def loop():
        time.sleep(90)  # let the deck warm up first
        while True:
            last = last_report()
            due = (last or {}).get("finished", 0) + hrs * 3600
            if time.time() >= due:
                start_scan(targets_fn, unifi_cfg, self_fn)
                due = time.time() + hrs * 3600
            _SCHED["next"] = due
            time.sleep(max(60, min(900, due - time.time())))

    th = threading.Thread(target=loop, name="helix-shield-sched", daemon=True)
    _SCHED["thread"] = th
    th.start()


# ───────────────────────── API ─────────────────────────

def snapshot() -> dict:
    b = load_baseline()
    return {
        "state": state(),
        "report": last_report(),
        "history": history(),
        "baseline": {"devices": len(b.get("devices") or {}), "muted": len(b.get("muted") or []), "seeded": b.get("seeded")},
        "interval_h": interval_h(),
        "next_scan": _SCHED.get("next"),
        "scope": [str(n) for n in scope_nets()],
        "modules": [
            {"id": "NETSERV", "label": "port + service sweep", "on": True},
            {"id": "TRANSCRYPT", "label": "TLS / PFS / cert", "on": True},
            {"id": "WEBI", "label": "web headers / cleartext login", "on": True},
            {"id": "UNIFI", "label": "devices / IPS / firmware", "on": True},
            {"id": "MRBIN", "label": "firmware analysis — not ported", "on": False},
        ],
    }


def act(body: dict, targets_fn, unifi_cfg, self_fn=None) -> dict:
    a = str(body.get("action") or "")
    if a == "scan":
        ok = start_scan(targets_fn, unifi_cfg, self_fn)
        return {"ok": ok, "error": None if ok else "scan already running"}
    b = load_baseline()
    if a == "ack_device":
        dev = str(body.get("dev") or "")[:64]
        if not dev:
            return {"ok": False, "error": "dev required"}
        b["devices"][dev] = {"name": str(body.get("name") or "")[:60], "ip": str(body.get("ip") or "")[:40], "first": time.time()}
        save_baseline(b)
        return {"ok": True}
    if a in ("mute", "unmute"):
        key = str(body.get("key") or "")[:120]
        if not key:
            return {"ok": False, "error": "key required"}
        muted = set(b.get("muted") or [])
        (muted.add if a == "mute" else muted.discard)(key)
        b["muted"] = sorted(muted)
        save_baseline(b)
        return {"ok": True}
    if a == "rebaseline":
        b["seeded"] = None
        b["devices"] = {}
        save_baseline(b)
        return {"ok": True}
    return {"ok": False, "error": "unknown action"}


# ───────────────────────── standalone (Unraid container) ─────────────────────────
# python3 helix_shield.py serve   → token-protected API on :8791 that the Mac deck proxies.

def _standalone_unifi_cfg() -> tuple[str | None, str]:
    return (_env("UNIFI_API_KEY") or None), (_env("UNIFI_URL", "https://192.168.1.1").rstrip("/"))


def _rdns(ip: str) -> str:
    try:
        return socket.gethostbyaddr(ip)[0]
    except OSError:
        return ""


def standalone_self() -> list[dict]:
    if _standalone_unifi_cfg()[0]:
        return []
    return [{"key": "self:no-unifi", "check": "no-unifi-key", "sev": "low", "ip": "", "host": "SHIELD (Unraid)", "port": "",
             "title": "UniFi intel offline", "detail": "No UNIFI_API_KEY in shield.env — discovery falls back to TCP sweep."}]


def standalone_targets() -> list[dict]:
    rows: dict[str, dict] = {}
    key, base = _standalone_unifi_cfg()
    if key:
        try:
            sites = _unifi_req(base, key, "/proxy/network/integration/v1/sites")
            data = sites.get("data") if isinstance(sites, dict) else sites
            sid = (data[0].get("id") if data else None) or "default"
            offset = 0
            while True:
                page = _unifi_req(base, key, f"/proxy/network/integration/v1/sites/{sid}/clients?limit=200&offset={offset}")
                items = (page.get("data") if isinstance(page, dict) else page) or []
                for c in items:
                    ip = c.get("ipAddress") or ""
                    if not ip:
                        continue
                    t = (c.get("type") or "").upper()
                    rows[ip] = {"ip": ip, "name": c.get("name") or c.get("hostname") or "", "mac": (c.get("macAddress") or "").lower() or None,
                                "vendor": c.get("manufacturer") or c.get("oui"), "wired": True if t == "WIRED" else False if t == "WIRELESS" else None,
                                "owner": "unknown", "source": "unifi"}
                offset += len(items)
                if len(items) < 200 or offset >= int(page.get("totalCount") or 0 if isinstance(page, dict) else 0):
                    break
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError, IndexError, AttributeError):
            pass
    if not rows:
        # no UniFi: light TCP discovery across small scope nets only (≤ /24)
        cand = [str(h) for n in scope_nets() if n.num_addresses <= 256 for h in n.hosts()]

        def live(ip):
            return ip if any(tcp_open(ip, p, 0.35) for p in (80, 443, 22, 445, 8080, 62078)) else None
        with ThreadPoolExecutor(max_workers=48) as pool:
            for ip in filter(None, pool.map(live, cand)):
                rows[ip] = {"ip": ip, "name": "", "owner": "unknown", "source": "tcp"}
    for ip in [x.strip() for x in _env("SHIELD_EXTRA_TARGETS").split(",") if x.strip()]:
        rows.setdefault(ip, {"ip": ip, "name": "", "owner": "infra", "source": "infra"})
    with ThreadPoolExecutor(max_workers=16) as pool:
        for ip, host in zip(list(rows), pool.map(_rdns, list(rows))):
            if host and not rows[ip].get("name"):
                rows[ip]["name"] = host.split(".")[0]
            rows[ip]["hostname"] = host or rows[ip].get("name") or ""
    return list(rows.values())


def serve() -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    token = _env("SHIELD_TOKEN")
    if len(token) < 24:
        sys.exit("SHIELD_TOKEN must be set (24+ chars) — refusing to expose an unauthenticated scanner.")
    port = int(_env("SHIELD_PORT", "8791"))
    DATA.mkdir(parents=True, exist_ok=True)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            return

        def _send(self, code, obj):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _ok(self):
            got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            if got and hmac.compare_digest(got, token):
                return True
            self._send(401, {"error": "token"})
            return False

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/health":
                return self._send(200, {"ok": True, "scanning": state()["scanning"]})
            if not self._ok():
                return
            if path == "/api/shield":
                return self._send(200, snapshot())
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._ok():
                return
            if self.path.split("?", 1)[0] != "/api/shield":
                return self._send(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(max(0, min(n, 2000))).decode() or "{}")
            except json.JSONDecodeError:
                body = {}
            self._send(200, act(body if isinstance(body, dict) else {}, standalone_targets, _standalone_unifi_cfg, standalone_self))

    start_scheduler(standalone_targets, _standalone_unifi_cfg, standalone_self)
    print(f"helix-shield listening on :{port} · scope {', '.join(map(str, scope_nets()))} · data {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve()
    elif len(sys.argv) > 1 and sys.argv[1] == "scan":
        rep = run_scan(standalone_targets, _standalone_unifi_cfg, standalone_self)
        print(json.dumps({"score": rep["score"], "grade": rep["grade"], "counts": rep["counts"], "hosts": len(rep["hosts"])}))
    else:
        print("usage: helix_shield.py serve | scan")
