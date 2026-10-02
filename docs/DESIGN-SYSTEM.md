# HELIX/OPS design system

Future agents must not restyle this into a generic dashboard.

## Identity

- Product: **HELIX OPS**
- Wordmark: **HELIX/OPS** (slash is the system bus)
- Node: **HOS://TKY-06** / **TOKYO-06**
- Mobile: **HELIX FIELD TERMINAL**
- Operator: **HΞL-01** (H.E.L.I.X. SYSTEM OPERATOR) — original ASCII, not a copyrighted character, not sexualized
- Core mark: geometric double-helix in a broken technical circle (`helix-core-mark.svg`)

## Palette

| Role | Token / typical |
|---|---|
| Background | `--bg` near-black with green cast `#060705` |
| Phosphor primary | `--ok` `#7CFF7A` |
| Bright phosphor | `#B8FFB0` / `#E8FFE2` |
| Amber | `--gold` `#d4a017` — processing / secondary only |
| Warning red | `--bad` `#c44a3a` |
| Cream | labels / ADZE phosphor |
| Dim | `--dim` `#7d8574` |

Wordmark particles are **square**, phosphor-green dominant. Amber is a bus pulse, not the logo fill.

## Geometry & type

Monospace / Japanese-capable (`Hiragino`, `Yu Gothic`, Menlo). Square corners, 1px `--line`, scanlines, PCB ticks. No rounded SaaS cards.

## Motion

Particle state machine in `helix-ops-wordmark.js`: ACQUIRE → MAP → CORE_FORM → CORE_SYNC → EXPAND → WORDMARK_BUILD → CALIBRATE → LOCK → IDLE. FULL boot ~2.5–4s, FAST on return, OFF on `prefers-reduced-motion`. TRACE bus pixels are one-shot real events — never looping fake traffic.

## Mobile

≤767px is Field Terminal (own IA), not a scaled desktop. First viewport: status, Hermes, CPU/MEM, net, Botmesh, Remote, alerts.

## Avoid

generic SaaS cards · glassmorphism · purple neon cyberpunk · huge gradients · Material rounded UI · Matrix rain · excessive glow · OMARCHY branding on the mark · fake telemetry
