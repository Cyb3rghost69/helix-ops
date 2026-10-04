"""HELIX/OPS voice — intent router into existing tools. No cloud STT/TTS required."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HIST = ROOT / "helix-voice.jsonl"
CFG_DEFAULT = {
    "voice_enabled": True,
    "voice_mode": "push_to_talk",  # push_to_talk | conversation | wake_word
    "stt_provider": "mac",
    "stt_model": "small",
    "stt_device": "auto",
    "stt_language": "en-AU",
    "tts_provider": "browser",
    "tts_voice": "",
    "tts_speed": 1.0,
    "tts_enabled": True,
    "voice_agent_provider": "auto",
    "wake_word_enabled": False,
    "wake_word": "helix",
    "vad_enabled": True,
    "silence_timeout_ms": 1400,
    "min_speech_ms": 280,
    "max_utterance_ms": 15000,
    "auto_play": True,
    "audio_retention": False,
    "volume": 0.85,
}

READ = "read"
LOW = "low"
SENSITIVE = "sensitive"
DESTRUCTIVE = "destructive"

_LOCK = threading.Lock()
_LAST: list[float] = []
_CFG: dict = {}
_TELEM: dict = {
    "status": "READY",
    "stt_ms": None,
    "tool_ms": None,
    "total_ms": None,
    "last_request": None,
    "session_started": None,
}


def _ops(name: str, default: str = "") -> str:
    v = (os.environ.get(name) or "").strip()
    if v:
        return v
    p = ROOT / "ops.env"
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    return default


def config() -> dict:
    global _CFG
    if _CFG:
        return dict(_CFG)
    c = dict(CFG_DEFAULT)
    c["voice_enabled"] = _ops("VOICE_ENABLED", "true").lower() not in ("0", "false", "off")
    c["voice_mode"] = _ops("VOICE_MODE", c["voice_mode"]) or c["voice_mode"]
    c["stt_provider"] = _ops("STT_PROVIDER", c["stt_provider"])
    c["stt_model"] = _ops("STT_MODEL", c["stt_model"])
    c["stt_device"] = _ops("STT_DEVICE", c["stt_device"])
    c["stt_language"] = _ops("STT_LANGUAGE", c["stt_language"])
    c["tts_provider"] = _ops("TTS_PROVIDER", c["tts_provider"])
    c["tts_voice"] = _ops("TTS_VOICE", c["tts_voice"])
    try:
        c["tts_speed"] = float(_ops("TTS_SPEED", str(c["tts_speed"])) or c["tts_speed"])
    except ValueError:
        pass
    c["tts_enabled"] = _ops("TTS_ENABLED", "true").lower() not in ("0", "false", "off")
    c["voice_agent_provider"] = _ops("VOICE_AGENT_PROVIDER", "auto")
    c["wake_word_enabled"] = _ops("WAKE_WORD_ENABLED", "false").lower() in ("1", "true", "on")
    c["wake_word"] = (_ops("WAKE_WORD", "helix") or "helix").lower()
    c["auto_play"] = _ops("VOICE_AUTO_PLAY", "true").lower() not in ("0", "false")
    c["audio_retention"] = _ops("VOICE_AUDIO_RETENTION", "false").lower() in ("1", "true")
    _CFG = c
    return dict(c)


def snapshot() -> dict:
    cfg = config()
    return {
        "ok": True,
        "config": cfg,
        "telemetry": dict(_TELEM),
        "history": _tail(12),
        "stt": {"provider": cfg["stt_provider"], "model": cfg["stt_model"], "note": "browser Web Speech is default; faster-whisper optional"},
        "tts": {"provider": cfg["tts_provider"], "voice": cfg["tts_voice"] or "system"},
        "agent": cfg["voice_agent_provider"],
        "wake_word": {"enabled": cfg["wake_word_enabled"], "word": cfg["wake_word"]},
    }


def _tail(n: int) -> list:
    if not HIST.is_file():
        return []
    lines = HIST.read_text(encoding="utf-8").splitlines()[-n:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def _rate() -> bool:
    now = time.time()
    with _LOCK:
        while _LAST and now - _LAST[0] > 60:
            _LAST.pop(0)
        if len(_LAST) >= 24:
            return False
        _LAST.append(now)
    return True


def _norm(text: str) -> str:
    t = (text or "").lower().strip()
    t = t.replace("helix,", " ").replace("helix ", " ")
    t = re.sub(r"[?!.,]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


ROOM = {
    "bedroom": "bedroom", "bed room": "bedroom",
    "blaine's room": "blaines-room", "blaines room": "blaines-room",
    "blaine": "blaines-room", "blaines": "blaines-room",
    "violet's room": "violets-room", "violets room": "violets-room",
    "violet": "violets-room", "violets": "violets-room",
    "all": None, "everything": None, "every light": None, "downstairs": None,
}

SCENES = {
    "movie": "movie", "tv": "movie", "film": "movie",
    "night": "night", "sleep": "night",
    "warm": "warm", "cozy": "warm",
    "cool": "cool", "daylight": "cool",
    "helix green": "helix-green", "helix": "helix-green", "green": "helix-green",
    "red alert": "red-alert", "red": "red-alert",
    "full bright": "full-bright", "bright": "full-bright",
    "off": "all-off",
}

COLORS = {
    "helix green": [124, 255, 122],
    "green": [124, 255, 122],
    "red": [200, 16, 8],
    "blue": [40, 80, 220],
    "purple": [160, 32, 240],
    "pink": [255, 80, 160],
    "orange": [255, 120, 20],
    "yellow": [255, 210, 40],
    "cyan": [40, 200, 220],
    "warm white": None,
}


WORDS = {
    "ten": 10, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
}

def parse_intent(text: str) -> dict:
    t = _norm(text)
    if not t:
        return {"ok": False, "error": "empty", "permission": READ, "confidence": 0}
    room = None
    for k, v in ROOM.items():
        if k in t:
            room = v
            break
    if room is None and re.search(r"\b(them|those|those lights)\b", t):
        try:
            from helix_control import context_room
            room = context_room()
        except Exception:
            room = None
    if re.search(r"\bgood\s*night\b", t):
        return {"ok": True, "tool": "home.scene.apply", "args": {"scene": "good-night"}, "permission": LOW, "confidence": 0.9}
    if room and re.search(r"what('s| is) on|what is happening|\bstatus\b", t) and not re.search(r"\b(on|off|percent|bright|dim|colour|color)\b", t.replace("what's on", " ")):
        return {"ok": True, "tool": "home.room.status", "args": {"room": room}, "permission": READ, "confidence": 0.86}
    m_pct = re.search(r"(\d{1,3})\s*(%|percent)", t)
    pct = int(m_pct.group(1)) if m_pct else None
    if pct is None:
        for w, n in WORDS.items():
            if re.search(rf"\b{w}\s*(percent|%)", t):
                pct = n
                break
    if pct is not None:
        pct = max(10, min(100, pct))

    if re.search(r"\b(delete|wipe|destroy)\b", t) and re.search(r"\b(plex|appdata)\b", t):
        return {"ok": True, "tool": "compute.destructive", "args": {"task": text.strip()}, "permission": DESTRUCTIVE, "confidence": 0.9, "speak_ask": "That is destructive. Approval is required on Helix COMPUTE. Voice is not approval."}
    if re.search(r"\b(shut\s*down|power\s*off|wipe|format|delete|destroy)\b", t) and re.search(r"\b(bigboi|unraid|server|array)\b", t):
        return {"ok": True, "tool": "server.shutdown", "args": {}, "permission": DESTRUCTIVE, "confidence": 0.9, "speak_ask": "Confirm shutdown of BigBoi?"}
    if re.search(r"restart\s+plex", t):
        return {"ok": True, "tool": "compute.privileged", "args": {"task": "restart plex"}, "permission": SENSITIVE, "confidence": 0.86, "speak_ask": "Restart Plex needs Helix approval. Voice is not approval."}
    if re.search(r"\b(unhealthy|what containers are unhealthy|what is wrong with|what's wrong with|why did .+ restart|what did medic|waiting for approval)\b", t):
        return {"ok": True, "tool": "medic.query", "args": {"text": text.strip()}, "permission": READ, "confidence": 0.8}
    if re.search(r"observe mode|disable auto repair", t):
        return {"ok": True, "tool": "medic.query", "args": {"text": text.strip()}, "permission": LOW, "confidence": 0.8}
    if re.search(r"docker", t) and re.search(r"\b(check|list|status|all)\b", t):
        return {"ok": True, "tool": "compute.docker_read", "args": {}, "permission": READ, "confidence": 0.88}

    if "rustdesk" in t or "remote desktop" in t:
        return {"ok": True, "tool": "rustdesk.status", "args": {}, "permission": READ, "confidence": 0.85}

    if re.search(r"\b(how many|how much|status|offline|online)\b", t) and "light" in t:
        return {"ok": True, "tool": "lights.list", "args": {}, "permission": READ, "confidence": 0.86}

    if re.search(r"\b(bigboi|unraid|the server)\b", t) and re.search(
        r"\b(status|hot|temp|cpu|ram|memory|running|online|offline|up|down|reachable)\b", t
    ):
        return {"ok": True, "tool": "server.status", "args": {}, "permission": READ, "confidence": 0.84}

    if "container" in t and re.search(r"\b(restart|stop|start)\b", t):
        name = re.search(r"container\s+([a-zA-Z0-9][a-zA-Z0-9_.-]{0,40})", t)
        act = "stop" if "stop" in t else ("start" if "start" in t else "restart")
        return {
            "ok": True,
            "tool": "server.restart_container" if act == "restart" else "server.container_control",
            "args": {"name": name.group(1) if name else "", "action": "stop" if act != "start" else "start"},
            "permission": SENSITIVE,
            "confidence": 0.7 if name else 0.4,
            "speak_ask": "Confirm container control?",
        }

    if re.search(r"(all lights off|turn (all |everything )?off|lights off|everything off)", t):
        if room:
            return {"ok": True, "tool": "lights.set_power", "args": {"group": room, "power": False}, "permission": LOW, "confidence": 0.88}
        return {"ok": True, "tool": "lights.all_off", "args": {}, "permission": LOW, "confidence": 0.9}

    if "light" in t or "lamp" in t or room:
        power = None
        if re.search(r"\b(on|enable)\b", t) and not re.search(r"\boff\b", t):
            power = True
        if re.search(r"\b(off|disable)\b", t):
            power = False
        scene = None
        for k, sid in SCENES.items():
            if k in t and k not in ("off",):
                scene = sid
                break
        color = None
        for k, rgb in COLORS.items():
            if k in t and rgb:
                color = rgb
                break
        if scene:
            return {"ok": True, "tool": "lights.activate_scene", "args": {"scene": scene, "group": room}, "permission": LOW, "confidence": 0.82}
        if pct is not None or "dim" in t or "bright" in t:
            return {"ok": True, "tool": "lights.set_brightness", "args": {"group": room, "value": pct or 30}, "permission": LOW, "confidence": 0.84}
        if color:
            return {"ok": True, "tool": "lights.set_color", "args": {"group": room, "rgb": color}, "permission": LOW, "confidence": 0.8}
        if power is not None:
            return {"ok": True, "tool": "lights.set_power", "args": {"group": room, "power": power}, "permission": LOW, "confidence": 0.86}

    return {"ok": True, "tool": "agent.prompt", "args": {"text": text.strip()}, "permission": READ, "confidence": 0.45}


def _speak_lights(out: dict, intent: dict) -> str:
    tel = (out or {}).get("telemetry") or {}
    tool = intent.get("tool")
    if out.get("error"):
        return "Lighting command failed."
    if tool == "lights.list":
        return f"{tel.get('online', 0)} lights online, {tel.get('offline', 0)} offline."
    if tool == "lights.all_off":
        return "All lights off."
    if tool == "lights.set_power":
        on = (intent.get("args") or {}).get("power")
        g = (intent.get("args") or {}).get("group") or "lights"
        return f"{g} lights {'on' if on else 'off'}."
    if tool == "lights.set_brightness":
        g = (intent.get("args") or {}).get("group") or "lights"
        v = (intent.get("args") or {}).get("value")
        return f"{g} lighting reduced to {v} percent." if v and v < 50 else f"{g} brightness {v} percent."
    if tool == "lights.set_color":
        g = (intent.get("args") or {}).get("group") or "lights"
        return f"{g} colour set."
    if tool == "lights.activate_scene":
        return f"Scene {(intent.get('args') or {}).get('scene')} applied."
    return "Lighting updated."


def execute(intent: dict, confirm: bool = False) -> dict:
    t0 = time.time()
    perm = intent.get("permission") or READ
    tool = intent.get("tool")
    args = intent.get("args") or {}
    if perm == DESTRUCTIVE and not confirm:
        return {"ok": False, "need_confirm": True, "permission": perm, "speak": intent.get("speak_ask") or "Confirm that action?", "tool": tool}
    if perm == SENSITIVE and not confirm:
        return {"ok": False, "need_confirm": True, "permission": perm, "speak": intent.get("speak_ask") or "Confirm that control action?", "tool": tool}
    if perm == DESTRUCTIVE and tool not in ("compute.destructive", "compute.privileged"):
        return {"ok": False, "error": "refused", "speak": "I will not run destructive actions from voice.", "permission": perm}

    result: dict = {"ok": False}
    if tool == "medic.query":
        import helix_medic as medic
        result = medic.query(str(args.get("text") or ""))
        speak = result.get("speak") or result.get("error") or "Medic."
        _TELEM["tool_ms"] = int((time.time() - t0) * 1000)
        return {"ok": bool(result.get("ok")), "tool": tool, "permission": perm, "result": {"ok": result.get("ok")}, "speak": speak}
    if tool and tool.startswith("home."):
        from helix_control import invoke as home_invoke
        result = home_invoke(tool, args)
        speak = result.get("speak") or (result.get("error") if not result.get("ok") else "Home updated.")
        if result.get("error") == "HOME CONTROL UNAVAILABLE":
            speak = "HOME CONTROL UNAVAILABLE"
        slim_home = {k: result.get(k) for k in ("ok", "error", "room", "status", "speak") if k in result}
        _TELEM["tool_ms"] = int((time.time() - t0) * 1000)
        return {"ok": bool(result.get("ok")), "tool": tool, "permission": perm, "result": slim_home, "speak": speak}
    if tool and tool.startswith("lights."):
        from helix_lights import act as lights_act, snapshot as lights_snap
        if tool == "lights.list":
            result = lights_snap()
            result["ok"] = True
            speak = _speak_lights(result, intent)
        elif tool == "lights.all_off":
            result = lights_act({"action": "all_off"})
            speak = _speak_lights(result, intent)
        elif tool == "lights.set_power":
            body = {"action": "on" if args.get("power") else "off"}
            if args.get("group"):
                body["group"] = args["group"]
            else:
                body["action"] = "all_off" if not args.get("power") else "on"
                if args.get("power") and not args.get("group"):
                    # on with no room → all groups
                    result = lights_act({"action": "on"})  # no-op without ids
                    snap = lights_snap()
                    for g in snap.get("groups") or []:
                        lights_act({"action": "on", "group": g["id"]})
                    result = lights_snap()
                    result["ok"] = True
                    speak = "Lights on."
                    _TELEM["tool_ms"] = int((time.time() - t0) * 1000)
                    return {"ok": True, "tool": tool, "permission": perm, "result": {"telemetry": result.get("telemetry")}, "speak": speak}
            result = lights_act(body)
            speak = _speak_lights(result, intent)
        elif tool == "lights.set_brightness":
            body = {"action": "brightness", "value": args.get("value")}
            if args.get("group"):
                body["group"] = args["group"]
            result = lights_act(body)
            speak = _speak_lights(result, intent)
        elif tool == "lights.set_color":
            body = {"action": "color", "rgb": args.get("rgb")}
            if args.get("group"):
                body["group"] = args["group"]
            result = lights_act(body)
            speak = _speak_lights(result, intent)
        elif tool == "lights.activate_scene":
            result = lights_act({"action": "activate_scene", "scene": args.get("scene"), "group": args.get("group")})
            speak = _speak_lights(result, intent)
        else:
            speak = "Unknown lighting tool."
        try:
            from helix_control import remember
            remember((args or {}).get("group"))
        except Exception:
            pass
    elif tool == "rustdesk.status":
        from rustdesk_remote import snapshot as rd
        # run callback not available — return short offline-safe text
        speak = "RustDesk status is on the REMOTE tab. Relay is the Unraid host."
        result = {"ok": True, "note": "see /api/remote"}
    elif tool == "server.status":
        import socket as _s
        from urllib.request import urlopen
        from urllib.error import URLError
        rtt = None
        t = time.time()
        try:
            sk = _s.socket(_s.AF_INET, _s.SOCK_STREAM)
            sk.settimeout(1.2)
            sk.connect(("192.168.1.84", 80))
            sk.close()
            rtt = int((time.time() - t) * 1000)
        except OSError:
            rtt = None
        honcho = False
        try:
            urlopen("http://192.168.1.84:8000/health", timeout=2)
            honcho = True
        except (URLError, OSError):
            honcho = False
        speak = "BigBoi is reachable." if rtt is not None else "BigBoi is not responding to ping."
        if rtt is not None:
            speak = f"BigBoi is online, about {rtt} milliseconds. Honcho is {'up' if honcho else 'down'}."
        result = {"ok": rtt is not None, "ping_ms": rtt, "honcho": honcho}
    elif tool == "compute.docker_read":
        from helix_compute import run_bigboi
        res = run_bigboi("docker")
        speak = "Docker on BigBoi: " + (res.get("out") or res.get("error") or "no data")[:120]
        result = {"ok": bool(res.get("ok")), "queued": False}
    elif tool == "compute.privileged":
        import helix_jobs
        helix_jobs.create_job(str(args.get("task") or "restart plex"))
        speak = "Privileged action needs Helix COMPUTE approval. Voice is not approval."
        result = {"ok": True, "queued": True}
    elif tool == "compute.destructive":
        import helix_jobs
        helix_jobs.create_job(str(args.get("task") or "destructive"))
        speak = "Destructive action is waiting on Helix COMPUTE. Voice is not approval."
        result = {"ok": True, "queued": True}
    elif tool == "agent.prompt":
        rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "text": str(args.get("text") or "")[:400], "src": "voice"}
        log = ROOT / "prompts.jsonl"
        with log.open("a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        text = str(args.get("text") or "").strip()
        speak = "Routing to Hermes."
        result = {"ok": True, "queued": True, "route": "hermes", "transcript": text}
    else:
        speak = "I did not map that to a Helix tool."
        result = {"ok": False, "error": "unmapped"}

    _TELEM["tool_ms"] = int((time.time() - t0) * 1000)
    slim = {k: result.get(k) for k in ("ok", "error", "telemetry", "ping_ms", "honcho", "queued", "route", "transcript") if k in result}
    out = {"ok": bool(result.get("ok", True)), "tool": tool, "permission": perm, "result": slim, "speak": speak}
    if result.get("route"):
        out["route"] = result["route"]
        out["transcript"] = result.get("transcript") or ""
    return out


def transcribe_audio(data: bytes, mime: str = "") -> str:
    if not data or len(data) < 80:
        return ""
    bin_path = ROOT / "helix-stt"
    if not bin_path.is_file():
        return ""
    ext = ".m4a"
    m = (mime or "").lower()
    if "wav" in m:
        ext = ".wav"
    elif "webm" in m:
        ext = ".webm"
    elif "ogg" in m:
        ext = ".ogg"
    elif "mpeg" in m or "mp3" in m:
        ext = ".mp3"
    import tempfile
    fd, path = tempfile.mkstemp(prefix="helix-stt-", suffix=ext)
    os.close(fd)
    try:
        Path(path).write_bytes(data)
        src = path
        if ext in (".webm", ".ogg"):
            conv = path + ".caf"
            import subprocess as sp
            c = sp.run(["/usr/bin/afconvert", "-f", "caff", "-d", "LEI16", path, conv], capture_output=True, timeout=12)
            if c.returncode == 0 and Path(conv).is_file():
                src = conv
        import subprocess as sp
        r = sp.run([str(bin_path), src], capture_output=True, text=True, timeout=26)
        text = (r.stdout or "").strip()
        return text
    except Exception:
        return ""
    finally:
        for p in (path, path + ".caf"):
            try:
                os.unlink(p)
            except OSError:
                pass


def _b64_audio(s: str) -> bytes:
    import base64
    raw = (s or "").strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw)
    except Exception:
        return b""


def utter(text: str, confirm: bool = False, stt_ms: int | None = None, provider: str = "auto") -> dict:
    t0 = time.time()
    cfg = config()
    if not cfg["voice_enabled"]:
        return {"ok": False, "error": "disabled", "speak": "Voice is disabled."}
    if not _rate():
        return {"ok": False, "error": "rate", "speak": "Voice rate limited."}
    intent = parse_intent(text)
    if not intent.get("ok"):
        return {"ok": False, "error": intent.get("error"), "speak": "I did not catch that."}
    if intent.get("confidence", 1) < 0.55 and intent.get("permission") in (SENSITIVE, DESTRUCTIVE):
        return {"ok": False, "need_confirm": True, "speak": "Please confirm that command.", "intent": intent}
    out = execute(intent, confirm=confirm)
    total = int((time.time() - t0) * 1000)
    _TELEM.update({
        "status": "READY",
        "stt_ms": stt_ms,
        "total_ms": total,
        "last_request": text[:80],
        "session_started": _TELEM.get("session_started") or time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    rec = {
        "t": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "user": text[:400],
        "provider": provider or cfg["voice_agent_provider"],
        "tool": intent.get("tool"),
        "permission": intent.get("permission"),
        "speak": out.get("speak"),
        "ok": out.get("ok"),
        "need_confirm": out.get("need_confirm"),
        "stt_ms": stt_ms,
        "tool_ms": _TELEM.get("tool_ms"),
        "total_ms": total,
        "tts": cfg["auto_play"],
    }
    if not cfg["audio_retention"]:
        rec["audio"] = False
    with HIST.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    out["intent"] = {"tool": intent.get("tool"), "permission": intent.get("permission"), "confidence": intent.get("confidence")}
    out["telemetry"] = dict(_TELEM)
    out["config"] = {"stt_provider": cfg["stt_provider"], "tts_provider": cfg["tts_provider"], "agent": cfg["voice_agent_provider"]}
    return out


def act(body: dict) -> dict:
    action = str(body.get("action") or "utter").lower()
    if action == "snapshot" or action == "status":
        return snapshot()
    if action == "config":
        global _CFG
        _CFG = {}
        return snapshot()
    if action in ("utter", "confirm"):
        audio = body.get("audio_b64") or body.get("audio")
        text = str(body.get("text") or "")
        stt_ms = body.get("stt_ms")
        if audio and not text.strip():
            t1 = time.time()
            text = transcribe_audio(_b64_audio(str(audio)), str(body.get("mime") or ""))
            stt_ms = int((time.time() - t1) * 1000)
            if not text:
                return {"ok": False, "error": "stt", "speak": "I could not transcribe that. Type the command below."}
        return utter(
            text,
            confirm=action == "confirm" or bool(body.get("confirm")),
            stt_ms=stt_ms,
            provider=str(body.get("provider") or "auto"),
        )
    return {"ok": False, "error": "bad action"}
