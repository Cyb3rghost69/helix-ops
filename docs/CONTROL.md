# HELIX CONTROL v1

Named `home.*` capabilities on top of existing WiZ lighting (`helix_lights.py`). No Home Assistant endpoint is configured. Browser never sees credentials. No `home.call_service`.

Rooms: Bedroom, Blaine's Room, Violet's Room, Unassigned.

Helix scenes (lighting only): GOOD NIGHT → existing `night`, MOVIE → `movie`, ALL LIGHTS OFF → `all_off`.

GET `/api/home` · POST `/api/home` · GET/POST `/api/prefs` · GET `/api/helix/doctor` · GET `/api/events`

Selective preference memory uses existing Honcho (`HELIX_PREF` conclusions). Classes: PREFERENCE, ALIAS, SCENE_PREFERENCE, COMPUTE_PREFERENCE. Explicit remember only — one-shot light commands do not write. Voice can create, not delete.
