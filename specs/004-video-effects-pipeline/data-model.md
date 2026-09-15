# Data Model: Video Effects Pipeline

These are participant-local runtime models. None is persisted or sent through the application control plane.

## EffectSelection

| Field | Type / rule |
|---|---|
| `background` | exactly one of `none`, `blur`, `custom` |
| `look` | exactly one of `natural`, `warm`, `monochrome` |
| `ar` | exactly one of `none`, `glasses`, `cat-ears`, `mask`, `face-paint`, `animated-fun` |
| `customBackgroundId` | local opaque ID; required for ready Custom; never a path |
| `generation` | increasing integer for every authoritative desired change |

Unknown IDs normalize to safe defaults. Custom without a ready resource stays selected-but-not-active.

## RequiredCapabilities

| Field | Derivation |
|---|---|
| `needsProcessor` | any nonzero Background, Look, or AR work |
| `needsSegmentation` | Blur or Custom only |
| `needsFaceLandmarks` | AR other than None only |
| `needsColorTransform` | Warm or Monochrome only |
| `needsAnimation` | Animated Fun and reduced motion is false |

## ProcessorRuntime

| Field | Type / meaning |
|---|---|
| `status` | `inactive`, `loading`, `active`, `unavailable`, `failed`, `fallback` |
| `ownedGeneration` | only this generation may commit state |
| `sourceTrackId` | current raw local camera track |
| `processedTrackId` | single final output track |
| `qualityTier` | `high`, `medium`, `low`, `off` |
| `segmentation`, `faceLandmarks` | capability runtime records |
| `lastFallbackReason` | bounded privacy-safe enum |
| `disposed` | terminal owner flag |

## CapabilityRuntime

Contains `state` (`idle/loading/ready/unavailable/failed/circuit-open`), one `inferenceInFlight` flag, bounded consecutive-failure count, and monotonic last-result time.

## CameraSource

Contains current opaque track ID, `facingMode` (`user/environment/unknown`), actual enabled/ready state. Screen share is never a CameraSource.

## CustomBackgroundResource

| Field | Validation / ownership |
|---|---|
| `id` | random local opaque ID |
| `status` | `decoding`, `ready`, `invalid`, `disposed` |
| `mimeType` | JPEG, PNG, or WebP after successful decode |
| `encodedBytes` | ≤8 MiB |
| `width`, `height` | positive, each ≤4096 |
| `objectUrl` | temporary, never serialized/logged, revoked once |
| `decodedImage` | draw-only pixel source, released on dispose |

## PerformanceSampleWindow

Fixed-size rolling render/inference durations, bounded skipped-frame counters, last tier-transition time, and bounded context-loss count. No per-frame telemetry leaves the browser.

## State transitions

```text
inactive → loading → active
             ├─ stale → cleanup → reconcile current generation
             ├─ partial failure → fallback healthy subset
             └─ unusable → unavailable/failed → raw
active → config update | lower tier | restart | fallback | inactive
fallback → loading/active | inactive/raw
any → disposed → inactive (no later mutation)
```

Custom image: `absent → decoding → ready`, with invalid/stale/replaced/None/owner teardown always ending in `disposed`.

## Invariants

1. One runtime owns one current camera source and at most one processed publication.
2. Desired state may lead runtime state; UI reports both truthfully.
3. Only current generation commits state.
4. Mic and screen-share never enter the graph.
5. Output is unmirrored; local front-camera mirror stays in the view.
6. Every resource has one idempotent disposal path.
