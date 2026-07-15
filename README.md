# companion-module-streamlabs-desktop

Bitfocus Companion module to control [Streamlabs Desktop](https://streamlabs.com/streamlabs-live-streaming-software) (formerly Streamlabs OBS) through its local remote control API (JSON-RPC 2.0 over SockJS, port 59650).

See [HELP.md](./companion/HELP.md) for user documentation (how to get the API token, actions, feedbacks, variables, presets) and [LICENSE](./LICENSE).

## Features

- Connection to a local Streamlabs Desktop instance with token auth, automatic reconnection with backoff, full state resync after reconnect, Companion status reporting
- Scenes: set active scene (dropdown or by name with variable support and optional case-insensitive matching), `scene_active` feedback, `current_scene` variables, real-time updates on manual scene switches
- Scene collections: switch action, `collection_active` feedback, `current_collection` variable, automatic resync on collection changes
- Source visibility: show / hide / toggle any scene item, `item_visible` feedback, real-time tracking
- Streaming / recording: toggle, start and stop actions (status-checked), feedbacks, raw status variables and `stream_duration` / `recording_duration` live timers
- Replay buffer: toggle / start / stop / save actions, feedback and status variables
- Studio mode: toggle / enable / disable / execute transition (refused by Streamlabs while dual output is enabled)
- Audio: mute / unmute / toggle per source, `audio_muted` feedback, one `mute_<source>` variable per source, real-time `sourceUpdated` tracking, configurable scope (all sources or current scene)
- Performance stats: CPU, FPS and dropped frames variables (2 s polling, optional) plus a dropped-frames threshold feedback
- Safety lock config option that disables the streaming actions (rehearsals, shared setups)
- Auto-generated presets: one per scene, STREAM / REC toggles with timers, replay buffer, one mute toggle per audio source, studio mode

## Backlog (v2+)

- Transitions selection (the API exposes studio mode; picking transition types is not exposed)
- Notifications service
- Dual output per-context statuses (`status.horizontal` / `status.vertical`)

## Development

Requirements: Node.js 22+, Yarn 4 (via corepack).

- `yarn` installs dependencies
- `yarn build` builds once into `dist/`, enough for the module to be loadable by Companion
- `yarn dev` runs the compiler in watch mode (Companion hot-reloads dev modules on rebuild)
- `yarn test` runs the unit tests (JSON-RPC layer, reconnection state machine, state helpers)
- `yarn lint` lints the sources
- `yarn package` builds and packages the module (`companion-module-build`)

To sideload the module during development, enable developer mode in Companion and point the "Developer modules path" to the parent folder of this repository.

### Releasing

Releases are automated by [`.github/workflows/release.yaml`](.github/workflows/release.yaml). To cut a release:

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit on `main`.
3. Tag the commit and push the tag:
   ```
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   ```

Pushing a `v*` tag runs lint/build/test, packages the module with `companion-module-build`, and publishes a GitHub Release with the `.tgz` attached (which can be imported into Companion via "Import offline module").

### Architecture

```
src/main.ts              module instance: lifecycle, state sync, event wiring
src/config.ts            config fields (host, port, secret token)
src/state.ts             in-memory mirror of the Streamlabs state
src/slobs/connection.ts  transport: SockJS + JSON-RPC 2.0 + auth + subscriptions + reconnect
src/slobs/types.ts       protocol types
src/actions.ts           action definitions
src/feedbacks.ts         feedback definitions
src/variables.ts         variable definitions
src/presets.ts           auto-generated presets
```

The transport layer (`SlobsConnection`) is framework-independent and unit-tested with an injectable socket factory. The API token is never written to any log.

### Manual smoke test against a running Streamlabs Desktop

With Streamlabs Desktop running and Remote Control enabled (Settings > Remote Control):

```
yarn build
SLOBS_TOKEN=<your token> node scripts/smoke-test.js
```

The script connects, authenticates, lists scenes, then listens for `sceneSwitched` events for a few seconds. The token is read from the environment and never printed.

### Manual test checklist

1. Without a token: the connection shows `Bad configuration`.
2. With a valid token and Streamlabs Desktop running: status `OK`, variables populated.
3. Press a scene preset button: the scene switches in Streamlabs and the button turns red.
4. Switch scenes manually in Streamlabs: `current_scene` and the feedbacks follow.
5. Start / stop the stream and the recording from Streamlabs or from Companion: feedbacks, variables and duration timers follow (`recording_status` also passes through `writing` while the file is finalized).
6. Mute / unmute an audio source on both sides: feedback and `mute_<source>` variable follow.
7. Show / hide a source on both sides: the `item_visible` feedback follows.
8. Start / stop the replay buffer, save a replay while it runs.
9. Quit and relaunch Streamlabs Desktop: the module reconnects and resynchronizes by itself.

## Protocol notes

- Auth is required even from localhost (`auth` on `TcpServerService`, first message).
- Subscriptions are made by calling the event channel name on its service; events arrive as `{_type: 'EVENT', emitter: 'STREAM', resourceId, data}`.
- Async API methods reply with `{_type: 'SUBSCRIPTION', emitter: 'PROMISE'}` and resolve through a later `EVENT`; the transport layer handles this transparently.
- The API only exposes `toggleStreaming` / `toggleRecording`; explicit start / stop refetch `getModel` first so a stale state can never invert the intent.
- Mute uses the documented `AudioSource["<id>"].setMuted`, with `SourcesService.setMuted` kept as a fallback (both verified live).
- Scene item visibility uses `SceneItem["<sceneId>","<sceneItemId>","<sourceId>"].setVisibility` (verified live, with `itemUpdated` events).
- `StreamingService.getModel` also carries `replayBufferStatus`, the `*StatusTime` timestamps used by the duration timers, and per-context statuses when dual output is enabled.
- Streamlabs silently refuses `enableStudioMode` while dual output is enabled; the module refetches the state after the call and warns instead of trusting the event.
