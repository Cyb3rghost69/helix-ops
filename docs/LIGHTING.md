# WiZ lighting (HELIX/OPS)

Local LAN control only. The browser never talks UDP to bulbs. Helix backend (`helix_lights.py`) sends WiZ JSON on UDP **38899**.

```
WiZ bulbs  --UDP 38899-->  Helix backend  --GET/POST /api/lights-->  LIGHTING tab
```

Provider abstraction: `LightingProvider` / `WizProvider`. Home Assistant can be added later without rewriting the UI.

## Dependencies

Python 3.11 stdlib (`socket`, `json`). **pywizlight is optional** — native UDP is the default so the dashboard stays pip-free.

## Enable Local Communication in the WiZ app

1. Open WiZ.
2. Settings → **Local communication** / LAN control → **on**.
3. Phone and Helix Mini must be on the same LAN (not guest VLAN unless you allow UDP 38899).

## Discovery

`POST /api/lights` `{"action":"discover"}` or **[ DISCOVER ]**.

Broadcast `getSystemConfig` to `WIZ_BROADCAST_ADDRESS` (auto: `x.x.x.255`) and `255.255.255.255`. Interval default **300s**. Known bulbs stay listed when offline.

This process is **not Docker**. No extra ports. UDP stays on the Mini.

## Manual IP

LIGHTING → MANUAL ADD, or `{"action":"add","ip":"192.168.1.40"}`.

## LIGHTS page (`#/lights`)

Rooms are panels; bulbs are pixel tiles that glow in their real colour and brightness.

- **Move a bulb:** drag it onto another room (mouse), or press-and-hold then drag (touch). Drop it on a bulb in another room to **swap** the two.
- **Tap a bulb** for power, brightness, white temperature, colour, WiZ scene, rename, **BLINK IT** (flashes the real bulb so you know which one it is) and MOVE TO ROOM buttons.
- **Room** header: on/off switch, brightness slider, colour swatches; **⋯** menu for room scenes, rename, reorder and delete (its bulbs go to Unassigned).
- **+ ROOM** adds a room; **DISCOVER**, **+ BY IP**, **ALL OFF**, and scene buttons for every room.

Extra POST actions: `add_group {name}`, `rename_group {group,name}`, `delete_group {group}`, `order_groups {order:[ids]}`, `rename {id,name}` (stored as `label`), `swap {id,with}`, `identify {id}`.

## Rooms

Device info → ROOM select, or `{"action":"assign","id":"<mac>","group":"bedroom"}`.

Groups: Bedroom, Blaine's Room, Violet's Room, Unassigned.

## Scenes

HELIX SCENES (FULL BRIGHT / NIGHT / MOVIE / WARM / COOL / RED ALERT / HELIX GREEN / ALL OFF) live in `helix-lights.json` (gitignored). `{"action":"activate_scene","scene":"helix-green"}`. `save_scene` adds custom rows.

## API (cookie auth, same as the rest of the deck)

| Method | Path | Body |
|---|---|---|
| GET | `/api/lights` | snapshot |
| POST | `/api/lights` | `{action, id?, group?, ip?, value?, rgb?, scene?}` |

Actions: `discover` `add` `assign` `on` `off` `toggle` `brightness` `color` `temperature` `wiz_scene` `all_off` `activate_scene` `save_scene`.

## Config (`ops.env`)

```
WIZ_ENABLED=true
WIZ_DISCOVERY_ENABLED=true
WIZ_BROADCAST_ADDRESS=
WIZ_DISCOVERY_INTERVAL=300
WIZ_STATE_POLL_INTERVAL=20
```

## Troubleshooting

| Symptom | Check |
|---|---|
| 0 devices | Local LAN on in WiZ app; same subnet; macOS firewall UDP; try manual IP |
| Command fails / OFFLINE | Bulb unplugged or IP changed — DISCOVER or ADD |
| Colour ignored | White-only bulb — use temperature |
| Docker | N/A — this deck is not containerised |

Do not Funnel `:8790`. Lighting rides the existing login cookie.
