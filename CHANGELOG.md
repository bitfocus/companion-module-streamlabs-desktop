# Changelog

All notable changes to this module are documented in this file.
Versions follow [semantic versioning](https://semver.org/).

## v1.0.0 (2026-07-15)

First public release of the native Streamlabs Desktop module for Bitfocus Companion, filling the gap left by the never-implemented `streamlabs-obs` stub (kept as a `legacyId` for store retro-compatibility).

The module talks to the Streamlabs Desktop remote control API (JSON-RPC 2.0 over SockJS, port 59650, token auth) and mirrors its state in real time.

### Connection

- Token authentication using a Companion secret config field (the token is never logged nor exported)
- Automatic reconnection with exponential backoff, re-subscription and full state resync after Streamlabs Desktop restarts
- Companion statuses: Connecting, OK, Authentication failure, Disconnected / Connection failure, Bad configuration
- Undocumented Streamlabs statuses are accepted and logged once to ease support

### Scenes and scene collections

- Actions: set active scene (dropdown, custom id accepted), set active scene by name (variables supported, optional case-insensitive matching), switch scene collection
- Feedbacks: `scene_active`, `collection_active`
- Variables: `current_scene`, `current_scene_id`, `current_collection`
- Real-time updates on manual scene switches and collection changes, with automatic resync of scenes, items and audio sources

### Source visibility

- Action: show / hide / toggle any scene item of any scene (folders handled)
- Feedback: `item_visible`
- Real-time tracking through `itemUpdated` events

### Streaming, recording and replay buffer

- Actions: toggle / start / stop for streaming and recording; toggle / start / stop / save for the replay buffer. Start and stop refetch the live status first, so a stale state can never invert the intent
- Feedbacks: `streaming_active`, `recording_active`, `replay_buffer_active`
- Variables: boolean states, raw statuses (including the undocumented `writing` recording status) and live `stream_duration` / `recording_duration` timers (HH:MM:SS)

### Audio

- Action: mute / unmute / toggle any audio source
- Feedback: `audio_muted`
- One `mute_<source>` variable per source, updated in real time
- Configurable scope: all audio sources of the collection, or the current scene only

### Studio mode

- Actions: toggle / enable / disable studio mode, execute the studio transition
- Feedback: `studio_mode_active`, variable `studio_mode`
- Note: Streamlabs Desktop refuses studio mode while dual output is enabled; the module detects it and logs a warning

### Performance monitoring

- Variables: `cpu_usage`, `fps`, `dropped_frames`, `dropped_frames_percent` (polled every 2 s, can be disabled)
- Feedback: `dropped_frames_above` threshold, for an on-air health button

### Presets

- One button per scene with the `scene_active` feedback pre-wired
- STREAM and REC toggles with live duration timers
- Replay buffer toggle and SAVE REPLAY
- One mute toggle per audio source
- Studio mode toggle and TAKE

### Configuration options

- Host / port / API token (secret)
- Audio sources scope (all / current scene only)
- Performance stats polling switch
- Streaming safety lock: disables the streaming actions during rehearsals or on shared setups

### Quality

- Unit test suite covering the JSON-RPC transport, the reconnection state machine and the state helpers
- Live validation script (`scripts/live-validation.js`) exercising the protocol against a running Streamlabs Desktop instance
- CI: lint, build, tests and the official Bitfocus module checks
