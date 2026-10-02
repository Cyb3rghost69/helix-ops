# Decisions

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
