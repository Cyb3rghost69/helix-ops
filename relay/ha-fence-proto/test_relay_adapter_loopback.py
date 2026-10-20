"""Level-2: real WebSocketRelayTransport + loopback Helix connector. Dummy HMAC only."""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

HERMES = str(Path.home() / ".hermes" / "hermes-agent")
if HERMES not in sys.path:
    sys.path.insert(0, HERMES)
PROTO = str(Path(__file__).resolve().parent)
if PROTO not in sys.path:
    sys.path.insert(0, PROTO)

import websockets

from gateway.relay.ws_transport import WebSocketRelayTransport
from helix_ws_connector import DUMMY_GID, DUMMY_SECRET, LoopbackConnector


class TestRelayAdapterLoopback(unittest.IsolatedAsyncioTestCase):
    async def test_handshake_auth_outbound(self):
        conn = LoopbackConnector()
        async with websockets.serve(conn.handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}/relay"
            t = WebSocketRelayTransport(
                url,
                "telegram",
                "sim-bot",
                gateway_id=DUMMY_GID,
                upgrade_secret=DUMMY_SECRET,
                reconnect=False,
            )
            ok = await t.connect()
            self.assertTrue(ok)
            desc = await t.handshake()
            self.assertEqual(desc.contract_version, 1)
            self.assertEqual(desc.platform, "telegram")
            self.assertTrue(conn.got_auth)
            self.assertTrue(conn.hellos)
            res = await t.send_outbound({"op": "send", "text": "iso"}, platform="telegram")
            self.assertTrue(res.get("success"))
            self.assertEqual(res.get("message_id"), "iso-out-1")
            await t.disconnect()

    async def test_bad_secret_rejected(self):
        conn = LoopbackConnector()
        async with websockets.serve(conn.handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}/relay"
            t = WebSocketRelayTransport(
                url,
                "telegram",
                "sim-bot",
                gateway_id=DUMMY_GID,
                upgrade_secret="wrong-secret-not-production-bbbbbbbb",
                reconnect=False,
            )
            with self.assertRaises(Exception):
                await asyncio.wait_for(t.connect(), timeout=5)


if __name__ == "__main__":
    unittest.main()
