# Changelog

All notable changes to this module are documented in this file.
Versions follow [semantic versioning](https://semver.org/).

## v1.0.2 (2026-08-28)

Store review fixes, following the feedback on the v1.0.1 submission, plus robustness fixes found by a full pre-resubmission review.

### Store review

- Remove the `streamlabs-obs` legacy id from the manifest: this is the initial release, so there is no older module to migrate from
- Rework the manifest keywords (`streaming`, `recording`, `scenes`, `live`): the module is already searchable via its manufacturer and shortname, and `obs` conflated it with the OBS Studio module
- Rename the manifest product to `Desktop` so the module lists as "Streamlabs: Desktop", following the "OBS: Studio" convention
- Remove the `CONFIG_DEFAULTS` fallback: defaults belong to the config field definitions, and future config migrations belong in upgrade scripts

### Robustness

- A rejected API token now keeps the connection status on "Authentication failure" instead of immediately overwriting it with "Disconnected" / "Connection failure"
- A failed initial state sync is now retried every 5 seconds instead of leaving the connection stuck in an error state while the transport is up
- Event subscriptions are registered once per connection: reconnections no longer subscribe every channel twice. An event channel rejected by Streamlabs (e.g. missing from an older version) is logged and skipped instead of aborting the whole handshake
- A failed authentication request now counts towards the reconnect backoff instead of retrying at full speed forever
- Async API calls (emitter `PROMISE`) now get a dedicated 60 s timeout for their deferred result instead of waiting forever, and report the error payload when Streamlabs rejects them
- All variables are published with default values at startup, so buttons no longer show `$NA` before the first connection
- Streaming, recording, replay buffer and performance variables and feedbacks reset to offline while disconnected, instead of freezing on their last live value
- Audio sources with colliding names now get a stable `sourceId`-based variable id, instead of an order-dependent underscore suffix that could silently swap between sources after a resync

## v1.0.1 (2026-07-16)

Maintenance release. No functional change; dependency and tooling updates only.

- Update the runtime `@companion-module/base` framework to 2.1.2
- Update dev tooling: `@types/node` to 26.x, `eslint` to 10.7, `prettier` to 3.9
- CI: bump `actions/setup-node` to v7
- Dependabot enabled for npm and GitHub Actions (weekly)

## v1.0.0 (2026-07-15)

First public release of the native Streamlabs Desktop module for Bitfocus Companion, filling the gap left by the never-implemented `streamlabs-obs` stub.

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
