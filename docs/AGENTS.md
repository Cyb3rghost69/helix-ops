# HELIX/OPS agents

No API keys in this file.

## Hierarchy

```
HELIX OPS          system / dashboard
HERMES             LEAD COGNITIVE CORE     provider: xai-oauth / grok-4.6
ADZE               INDEPENDENT ANALYSIS    provider: OpenAI / gpt-4o (when key present)
HΞL-01             SYSTEM OPERATOR UI      not a model
Prefect/Foreman/Canon/Scribe   silent Mac workers (oneshot)
Unraid worker      web/peer only, no Telegram
```

## HERMES

Primary decision maker and the only Telegram face. Tools run only after Hermes authorizes them. Observable TRACE: request / tool name / result / response. Do **not** dump hidden chain-of-thought.

## ADZE

Silent critic. OpenAI exclusively. No tools. Max 3 deliberation rounds. Modes: off / auto / always / manual (default auto). `ALLOW_ADZE_LEAD_FAILOVER=false`. If Hermes and ADZE disagree, record both; Hermes executes. Offline until `OPENAI_API_KEY` is set locally.

## HΞL-01

ASCII operator on Field Terminal. Status lines come from real agent/remote/git events only.

## Communication

ADZE does not talk on Telegram/Discord. Prefect talks only to Helix. Do not spawn extra Telegram bots.

## Failure

Missing OpenAI key → ADZE `OPENAI PROVIDER UNAVAILABLE`. Codex 429 is a Hermes fallback issue, not ADZE. Do not bounce the Mac gateway to “wake” silent profiles.
