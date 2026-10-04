# Decisions

## 2026-10-04 — Gap close (CTX / recorder / SMART / Sentinel)
**DECISION:** Live CTX reports model capacity and session lifetime tokens; current window occupancy stays NO TELEMETRY. Flight recorder persists sanitized metrics with 7D downsample. Mac SMART overall only. Sentinel has no decorative hostile contacts.
**REASON:** Scorecard PARTIAL items must not be greened with invented telemetry.
**ALTERNATIVES:** Estimate window from sessionInput/capacity; Unraid smartctl over SSH.
**CONSEQUENCES:** CTX % never appears until Hermes exposes a live window. Unraid SMART remains MISSING.

## 2026-10-04 — Adaptive command centre
**DECISION:** HelixOrch derives SYSTEM STATE from real subsystem snapshots; Priority Engine uses hysteresis (margin/min-show/cooldown); MEMORY.md utilization is CORE MEMORY, host RAM is SYSTEM. No fake health %. Flight recorder stores metrics/events only.  
**REASON:** Operator asked for one coherent machine, not independent polling cards.  
**ALTERNATIVES:** Rebuild panels; numeric sort every frame.  
**CONSEQUENCES:** Offscreen canvases pause; historical mode is explicit.

## 2026-10-02 — Voice PTT
**DECISION:** Browser Web Speech STT/TTS; backend intent router into existing tools; wake-word off by default; no faster-whisper on the 8 GB Mini yet.  
**REASON:** Spec said ship reliable PTT first.  
**ALTERNATIVES:** faster-whisper + Kokoro services.  
**CONSEQUENCES:** Firefox has no STT; destructive voice commands never execute.

## 2026-10-02 — WiZ local lighting
**DECISION:** Helix backend owns WiZ UDP 38899; UI polls `/api/lights`. Stdlib protocol, optional pywizlight. Provider ABC for future Home Assistant.  
**REASON:** No cloud, no browser-to-bulb UDP, no extra ports.  
**ALTERNATIVES:** pywizlight-only; Home Assistant first.  
**CONSEQUENCES:** `helix-lights.json` gitignored; Funnel still off.

## 2026-10-02 — HELIX/OPS branding
**DECISION:** Canonical identity is HELIX/OPS (slash as system bus), not OMARCHY and not HELIX INDUSTRIES on the mark.  
**REASON:** Operator identity for the Tokyo-06 deck.  
**ALTERNATIVES:** Keep amber Omarchy-derived wordmark.  
**CONSEQUENCES:** Particle logo samples HELIX/OPS; phosphor green is primary.

## 2026-10-02 — Phosphor primary
**DECISION:** `#7CFF7A` / `--ok` for identity; amber for activity only.  
**REASON:** Terminal/supercomputer, not orange logo.  
**ALTERNATIVES:** Keep gold wordmark.  
**CONSEQUENCES:** Design system forbids purple cyberpunk restyles.

## 2026-09 — Hermes lead, ADZE OpenAI critic
**DECISION:** Hermes stays Grok/xai-oauth; ADZE is a separate OpenAI profile with no tools.  
**REASON:** Independent second opinion without mixing providers.  
**ALTERNATIVES:** Single-model review; failover ADZE to lead.  
**CONSEQUENCES:** Failover off; no OpenAI key in frontend.

## 2026-09 — RustDesk OSS transport
**DECISION:** ich777 RustDeskServer-AiO; HELIX launches `rustdesk://` only.  
**REASON:** Do not invent a custom remote-desktop protocol.  
**ALTERNATIVES:** Pro API, VNC iframe.  
**CONSEQUENCES:** No session telemetry; no passwords on the dashboard.

## Standing — no hidden CoT
**DECISION:** TRACE and thoughts show observable events; never reconstruct private chain-of-thought.  
**REASON:** Safety and honesty.  
**CONSEQUENCES:** Missing values are NO TELEMETRY.

## Standing — secrets stay off GitHub
**DECISION:** `ops.env`, `unifi.env`, keys, DBs, jsonl, RustDesk private material are gitignored.  
**REASON:** GitHub is project memory, not a backup of runtime.  
**ALTERNATIVES:** Encrypted git-crypt.  
**CONSEQUENCES:** `.env.example` has names only.
