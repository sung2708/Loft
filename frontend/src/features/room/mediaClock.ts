export function canonicalPositionMs(positionMs: number, startedAt: string, status: string, serverNow: number) {
  if (status !== "PLAYING" || !startedAt) return positionMs;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return positionMs;
  return positionMs + Math.max(0, serverNow - start);
}

export type DriftCorrection =
  | { kind: "none" }
  | { kind: "rate"; rate: number }
  | { kind: "seek"; positionMs: number };

// The YouTube IFrame API only accepts rates advertised by the current video.
// When 0.95/1.05 are unavailable, leave short drift alone and hard-seek only
// once it grows beyond the audible correction range.
export function driftCorrection(
  localMs: number,
  canonicalMs: number,
  playbackRate: number,
  availableRates: readonly number[],
): DriftCorrection {
  if (!Number.isFinite(localMs) || !Number.isFinite(canonicalMs)) return { kind: "none" };
  const drift = localMs - canonicalMs;
  const magnitude = Math.abs(drift);

  if (magnitude > 1500) return { kind: "seek", positionMs: Math.max(0, canonicalMs) };
  if (playbackRate !== 1 && magnitude < 50) return { kind: "rate", rate: 1 };

  if (magnitude >= 250) {
    const rate = drift > 0 ? 0.95 : 1.05;
    if (availableRates.includes(rate) && playbackRate !== rate) {
      return { kind: "rate", rate };
    }
    if (!availableRates.includes(rate) && playbackRate !== 1) {
      return { kind: "rate", rate: 1 };
    }
  }

  return { kind: "none" };
}
