# Contract: Video Effect Processor Lifecycle

## Ownership

One controller belongs to one mounted existing LiveKit media context. Only it may attach, restart, stop, or destroy the local camera processor. The store never manipulates tracks.

| Operation | Preconditions | Required result |
|---|---|---|
| `init` | current camera, current generation, processing required | one unmirrored output; only required capabilities initialized |
| `updateConfig` | active processor, same source | atomic config snapshot; lazy add/release capabilities |
| `restart` | replacement camera source | rebind without duplicate loop/output/publication |
| `destroy` | any state | idempotent cleanup and no stale mutation |

## Reconciliation

1. Every desired/media-owner change creates a newer generation.
2. Track lifecycle mutations execute serially.
3. After every await, verify generation, disposal, and source identity.
4. Stale work cleans only its own resources and cannot attach/publish/report active.
5. No processing calls the SDK raw-track restoration path.
6. A capability failure recomputes the healthiest subset; raw is used only when no processing remains.

## Frame bounds

- One render loop per active processor.
- At most one segmentation and one landmark inference in flight.
- Busy frames skip or reuse a bounded recent result; never queue.
- Cadence follows quality tier and stops when unowned/off.
- No frame/landmark telemetry.

## Isolation and failures

Input/output are local camera video only. Microphone and all screen-share tracks are excluded. Existing local front-camera presentation mirror remains outside the processor.

| Failure | Response |
|---|---|
| Segmentation | Disable Blur/Custom; preserve Look/AR |
| Landmarks | Disable AR; preserve Background/Look |
| Image decode | Reject image; preserve healthy camera/composition |
| Context loss | One bounded recovery; repeated loss falls back |
| Output ends | Reconcile once; no retry loop |
| Source ends | Existing media owner updates camera; destroy stale processor |

Two consecutive unrecoverable errors open a session circuit for that capability. Explicit retry is bounded.

## Cleanup acceptance

After disable, camera off, replacement, reconnect reconciliation, leave, or unmount: no stale loops, timers, listeners, workers/tasks, object URLs, canvases, processed tracks, or duplicate publications; mic and screen state are unchanged.
