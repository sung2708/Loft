# SFX Asset Inventory

**Source**: User-provided WAV files at repository root. The user supplied and previously requested
application of the full set; confirm redistribution rights before any public release.

**Processing**: Generated runtime derivatives are mono PCM 16-bit/48 kHz with trailing silence below
-45 dB removed. Source files remain untouched for recovery. Runtime gain is additionally constrained
by the fixed SFX manifest.

| Runtime asset | Category | Audible duration | Intended cue |
|---|---|---:|---|
| `cam-off.wav` | UI | 0.969s | Camera off |
| `cam-on.wav` | UI | 1.181s | Camera on |
| `disconnect.wav` | Room | 1.633s | Connection lost |
| `error.wav` | UI | 1.391s | Optional non-blocking error |
| `host-transfer.wav` | Room | 0.989s | Host changed |
| `mute.wav` | UI | 1.170s | Local mute |
| `participant-join.wav` | Room | 0.210s | Remote participant joined |
| `participant-leave.wav` | Room | 1.821s | Remote participant left |
| `raise-hand.wav` | Room | 1.359s | Hand raised |
| `reconnect.wav` | Room | 1.652s | Reconnected |
| `remove-from-room.wav` | Room | 1.339s | Local removal |
| `room-enter.wav` | Room | 1.310s | Initial room entry |
| `screen-end.wav` | UI | 1.930s | Local sharing ended |
| `screen-start.wav` | UI | 1.322s | Local sharing started |
| `unmute.wav` | UI | 1.233s | Local unmute |

## Review Notes

- All files decode successfully and are exactly two seconds at source.
- Runtime derivatives remove large trailing-silence regions and reduce stereo storage.
- Several cues remain longer than the preferred micro-feedback window. Runtime playback is safe, but
  subjective listening and final mastering are still required before declaring sonic-design approval.
- Reactions and chat intentionally have no assets and remain silent.
