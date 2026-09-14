export type StageLayout =
  | { mode: "empty" }
  | { mode: "screen-share" }
  | { mode: "solo" }
  | { mode: "grid"; columns: number; rows: number };

export function deriveStageLayout(
  participantCount: number,
  hasScreenShare: boolean,
  width: number,
  height: number,
): StageLayout {
  if (hasScreenShare) return { mode: "screen-share" };
  if (participantCount < 1) return { mode: "empty" };
  if (participantCount === 1) return { mode: "solo" };

  if (participantCount <= 4) {
    const columns = width < 600 || (participantCount === 2 && width < height)
      ? 1
      : 2;
    return { mode: "grid", columns, rows: Math.ceil(participantCount / columns) };
  }

  const gap = 12;
  let bestColumns = 1;
  let bestScore = -1;
  for (let columns = 1; columns <= Math.min(participantCount, 6); columns++) {
    const rows = Math.ceil(participantCount / columns);
    const tileWidth = (width - gap * (columns - 1)) / columns;
    const tileHeight = (height - gap * (rows - 1)) / rows;
    if (tileWidth < 140) continue;
    const visibleHeight = Math.max(tileHeight, 150);
    const score = Math.min(tileWidth / 16, visibleHeight / 9) *
      (tileHeight < 150 ? 0.7 : 1);
    if (score > bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }
  return {
    mode: "grid",
    columns: bestColumns,
    rows: Math.ceil(participantCount / bestColumns),
  };
}
