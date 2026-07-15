# Streamlabs Desktop

This module controls Streamlabs Desktop (formerly Streamlabs OBS) through its built-in remote control API: scenes, scene collections, source visibility, streaming, recording, replay buffer, studio mode and audio sources, with live feedback and performance stats on your buttons.

## Requirements

- A recent Companion 4.x (developed and tested against 4.3.4)
- Streamlabs Desktop running on the same machine as Companion (or reachable on your local network)
- Remote Control enabled in Streamlabs Desktop (Settings > Remote Control)

## Getting the API token

1. In Streamlabs Desktop, open **Settings** > **Remote Control**.
2. Click the QR code, then click **Show details**.
3. Copy the **API token** and paste it in the module configuration.
4. The port is shown there too (default `59650`).

If you ever need to revoke access, use **Generate new token** in the same screen, then update the module configuration.

## Configuration

| Field              | Description                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Host               | IP of the machine running Streamlabs Desktop. Keep `127.0.0.1` when it runs next to Companion.                                 |
| Port               | Remote control port, default `59650`.                                                                                          |
| API token          | The token from Settings > Remote Control (see above). Stored as a secret.                                                      |
| Audio sources list | "All audio sources" targets any source of the collection. "Current scene only" keeps lists short but follows the active scene. |
| Performance stats  | Polls CPU, FPS and dropped frames every 2 seconds into variables.                                                              |
| Safety lock        | When enabled, the Streaming start/stop/toggle actions do nothing. Handy during rehearsals or on shared setups.                 |

## Actions

| Action                                                      | Description                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Scene: Set active scene                                     | Switch to a scene picked from a dropdown (a custom scene id is accepted too).                    |
| Scene: Set active scene by name                             | Switch to the scene matching this name, with an optional "ignore case" mode. Supports variables. |
| Scene collection: Switch                                    | Loads another scene collection (Streamlabs reloads all scenes and sources).                      |
| Streaming: Toggle / Start / Stop                            | Control the stream. Start and Stop check the live status first, so they are safe to retrigger.   |
| Recording: Toggle / Start / Stop                            | Control the recording, same behaviour as streaming.                                              |
| Replay buffer: Toggle / Start / Stop / Save replay          | Control the replay buffer and save it to disk while it is running.                               |
| Audio: Mute / unmute source                                 | Mute, unmute or toggle any audio source.                                                         |
| Source: Show / hide scene item                              | Show, hide or toggle any source of any scene.                                                    |
| Studio mode: Toggle / Enable / Disable / Execute transition | Control studio mode and send the preview to program.                                             |

## Feedbacks

| Feedback                       | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Scene is active                | Button style changes while the selected scene is on air (default red).         |
| Streaming is active            | Active while the stream is starting, live, ending or reconnecting.             |
| Recording is active            | Active while the recording is starting, running, stopping or writing.          |
| Replay buffer is running       | Active while the replay buffer runs (default green).                           |
| Audio source is muted          | Active while the selected audio source is muted.                               |
| Scene item is visible          | Active while the selected source is visible in its scene (default green).      |
| Scene collection is active     | Active while the selected collection is loaded.                                |
| Studio mode is enabled         | Active while studio mode is on (default orange).                               |
| Dropped frames above threshold | Active when the dropped frames percentage reaches your threshold (default 1%). |

## Variables

| Variable                 | Description                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| `current_scene`          | Name of the active scene                                              |
| `current_scene_id`       | Id of the active scene                                                |
| `current_collection`     | Name of the active scene collection                                   |
| `streaming`              | `true` / `false`                                                      |
| `streaming_status`       | Raw status: `offline`, `starting`, `live`, `ending`, `reconnecting`   |
| `stream_duration`        | Time since the stream went live, `HH:MM:SS`                           |
| `recording`              | `true` / `false`                                                      |
| `recording_status`       | Raw status: `offline`, `starting`, `recording`, `stopping`, `writing` |
| `recording_duration`     | Time since the recording started, `HH:MM:SS`                          |
| `replay_buffer`          | `true` / `false`                                                      |
| `replay_buffer_status`   | Raw status: `offline`, `running`, `stopping`, `saving`                |
| `studio_mode`            | `true` / `false`                                                      |
| `cpu_usage`              | CPU usage of Streamlabs Desktop (%)                                   |
| `fps`                    | Current output frame rate                                             |
| `dropped_frames`         | Number of dropped frames                                              |
| `dropped_frames_percent` | Percentage of dropped frames                                          |
| `mute_<source name>`     | `true` / `false`, one variable per audio source                       |

Everything updates in real time, including when you act directly in Streamlabs Desktop.

## Presets

- **Scenes**: one ready-made button per scene, wired to switch to it and turn red while it is active.
- **Streaming and recording**: STREAM and REC toggles with live timers, replay buffer toggle and SAVE REPLAY.
- **Audio**: one mute toggle per audio source, red while muted.
- **Studio mode**: studio mode toggle and TAKE (transition) buttons.

Drop them from the Presets tab onto your buttons and you are done.

## Status and troubleshooting

- `Connecting`: the module is trying to reach Streamlabs Desktop.
- `OK`: authenticated and synced.
- `Authentication failure`: the token was rejected. Re-copy it from Settings > Remote Control (Show details), or generate a new one.
- `Disconnected` / `Connection failure`: Streamlabs Desktop is closed or unreachable. The module reconnects automatically with a progressive backoff and resynchronizes everything as soon as Streamlabs is back.
- `Bad configuration`: the token is missing in the module configuration.

Notes:

- Studio mode is refused by Streamlabs Desktop when **dual output** is enabled; the module logs a warning in that case.
- The replay buffer must be enabled in the Streamlabs output settings for the replay actions to do anything.
- Switching scene collections reloads all scenes and sources; the module resynchronizes itself once the new collection is loaded.
