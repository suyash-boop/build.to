export const POSITION_STEP = 1024;
/** Below this gap between neighbours, renumber the column to avoid float precision collapse. */
export const MIN_GAP = 1e-6;

/**
 * Position for an item placed between `before` (above) and `after` (below).
 * Either may be null at the ends of the list.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return POSITION_STEP;
  if (before == null) return (after as number) - POSITION_STEP;
  if (after == null) return before + POSITION_STEP;
  return (before + after) / 2;
}

export function needsRebalance(before: number | null, after: number | null, position: number): boolean {
  return (
    (before != null && Math.abs(position - before) < MIN_GAP) || (after != null && Math.abs(after - position) < MIN_GAP)
  );
}
