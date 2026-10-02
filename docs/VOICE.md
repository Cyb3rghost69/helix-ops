# Voice interface (HELIX/OPS)

Push-to-talk first. Browser STT + browser TTS. Backend routes speech to **existing** Helix tools (lights, BigBoi ping, prompt log). No extra ports, no Docker split.

```
Mic → Web Speech API (browser)
        → POST /api/voice {action:utter, text}
        → helix_voice.parse_intent → helix_lights / status / prompts.jsonl
        → speak via speechSynthesis
```

## Use

1. Hard-refresh → **[09] VOICE**
2. Allow microphone when the browser asks.
3. **PUSH TO TALK** — click, speak, click again (or wait for final transcript).
4. **MUTE** stops capture and TTS.
5. **CONVERSATION** keeps listening after Helix finishes speaking.
6. **WAKE WORD** (optional): local phrase `helix` via the same Web Speech engine. Off by default. Does **not** stream audio to a cloud wake service.
7. Dangerous phrases (shutdown BigBoi) ask **CONFIRM** and still refuse destructive execution.

Chrome/Safari. Firefox has no Web Speech STT — error state.

## Providers (abstractions)

| Role | Default | Optional later |
|---|---|---|
| STT | `browser` (Web Speech, en-AU) | faster-whisper / OpenAI transcription |
| TTS | `browser` (speechSynthesis) | Kokoro / Piper / OpenAI TTS |
| Agent | `auto` = tool router first | Hermes 8642 / Ollama |

Mini is 8 GB ARM — faster-whisper is **not** bundled. Set `STT_PROVIDER=faster_whisper` only after you install it.

## Tools (permission)

READ: lights.list, server.status, rustdesk.status  
LOW: lights on/off/brightness/color/scene  
SENSITIVE: container control (confirm)  
DESTRUCTIVE: shutdown — never executed from voice

WiZ commands use `helix_lights.act`, not a second UDP path.

## Config (`ops.env`)

```
VOICE_ENABLED=true
VOICE_MODE=push_to_talk
STT_PROVIDER=browser
STT_LANGUAGE=en-AU
TTS_PROVIDER=browser
TTS_ENABLED=true
VOICE_AGENT_PROVIDER=auto
WAKE_WORD_ENABLED=false
WAKE_WORD=helix
VOICE_AUTO_PLAY=true
VOICE_AUDIO_RETENTION=false
```

Audio is not stored. Transcripts go to gitignored `helix-voice.jsonl`.

## API

GET `/api/voice` — config + telemetry + history  
POST `/api/voice` `{action: utter|confirm|snapshot, text, confirm}`

Cookie auth, same as the rest of the deck.

## Files

- `helix_voice.py` — intent, permissions, history
- `helix-voice.js` / `helix-voice.css` — UI
- `docs/VOICE.md` — this file
