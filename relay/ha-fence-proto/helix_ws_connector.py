"""Loopback Helix connector: newline JSON /relay, dummy HMAC. No production tokens."""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from gateway.relay.auth import make_upgrade_token, sign
import base64
import time

DESC = {
    "contract_version": 1,
    "platform": "telegram",
    "label": "Helix ISO Telegram",
    "max_message_length": 4096,
    "supports_draft_streaming": False,
    "supports_edit": True,
    "supports_threads": True,
    "markdown_dialect": "markdown_v2",
    "len_unit": "utf16",
}

DUMMY_GID = "gw-helix-iso"
DUMMY_SECRET = "helix-iso-dummy-secret-not-production-aaaa"


def verify_upgrade(token: str, secret: str, gateway_id: str) -> bool:
    pad = "=" * ((4 - len(token) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(token + pad).decode("ascii")
        payload, exp_s, sig = raw.rsplit(":", 2)
        exp = int(exp_s)
    except Exception:
        return False
    if payload != gateway_id:
        return False
    if exp and exp < int(time.time()) - 5:
        return False
    return sig == sign(f"{payload}:{exp}", secret)


class LoopbackConnector:
    def __init__(self):
        self.hellos = []
        self.outbounds = []
        self.acks = []
        self.got_auth = False

    async def handler(self, ws):
        path = getattr(getattr(ws, "request", None), "path", "") or ""
        if path not in ("/relay", "/relay/"):
            await ws.close(code=1008, reason="path")
            return
        hdrs = getattr(getattr(ws, "request", None), "headers", None)
        auth = ""
        if hdrs is not None:
            auth = hdrs.get("Authorization") or hdrs.get("authorization") or ""
        if auth.startswith("Bearer "):
            self.got_auth = verify_upgrade(auth[7:].strip(), DUMMY_SECRET, DUMMY_GID)
            if not self.got_auth:
                await ws.close(code=4401, reason="unauthorized")
                return
        async for raw in ws:
            text = raw if isinstance(raw, str) else raw.decode("utf-8")
            for line in text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                frame = json.loads(line)
                typ = frame.get("type")
                if typ == "hello":
                    self.hellos.append(frame)
                    await ws.send(json.dumps({"type": "descriptor", "descriptor": DESC}) + "\n")
                elif typ == "outbound":
                    self.outbounds.append(frame)
                    rid = frame.get("requestId")
                    await ws.send(
                        json.dumps(
                            {
                                "type": "outbound_result",
                                "requestId": rid,
                                "result": {"success": True, "message_id": "iso-out-1"},
                            }
                        )
                        + "\n"
                    )
                elif typ == "inbound_ack":
                    self.acks.append(frame)
