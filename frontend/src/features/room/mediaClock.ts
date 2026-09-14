export function canonicalPositionMs(positionMs: number, startedAt: string, status: string, serverNow: number) {
  if (status !== "PLAYING" || !startedAt) return positionMs;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return positionMs;
  return positionMs + Math.max(0, serverNow - start);
}
