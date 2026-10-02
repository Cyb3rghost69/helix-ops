# REMOTE MATRIX // RustDesk

**IMPLEMENTED** against OSS ich777 **RustDeskServer-AiO** on Unraid `192.168.1.84`.

| Capability | OSS |
|---|---|
| HBBS 21116 / HBBR 21117 health | yes (TCP) |
| Device directory | hbbs `peer` table (id + info) + Mac `RustDesk_lan_peers.toml` |
| Online status | LAN `online` flag when present; hbbs `status` often empty |
| Sessions / DIRECT vs RELAY | **no** |
| API 21114 | closed (expected) |
| Launch | `rustdesk://connection/new/<id>` + COPY ID |
| Passwords / private keys | never on dashboard |

Pubkey path on Unraid (do not commit or paste): `/mnt/cache/appdata/rustdeskserver-aio/id_ed25519.pub`

Favorites/map: local `helix-remote.json` (gitignored).
