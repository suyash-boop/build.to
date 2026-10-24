/**
 * One motion vocabulary for the whole app. Short, decelerating, never bouncy: things settle into
 * place rather than perform. Every duration stays under 250ms so motion never gates interaction.
 */
export const ease = {
  /** Default for enter and move: fast start, soft landing. */
  out: [0.22, 1, 0.36, 1] as const,
  /** For exits: leaves quickly. */
  in: [0.4, 0, 1, 1] as const,
};

export const duration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.24,
};

/** Spring for shared-layout indicators (tabs, nav highlight): critically damped, no overshoot. */
export const indicatorSpring = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 } as const;
