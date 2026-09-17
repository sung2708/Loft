export const EASE_ENTRANCE = [0.4, 0, 0.2, 1] as const;
export const EASE_SPATIAL = [0.4, 0, 0.2, 1] as const;
export const EASE_EXIT = [0.4, 0, 1, 1] as const;

export const STAGE_VARIANTS = {
  initial: { opacity: 0, scale: 0.98 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: EASE_ENTRANCE },
  },
  exit: {
    opacity: 0,
    scale: 0.985,
    transition: { duration: 0.2, ease: EASE_EXIT },
  },
};
