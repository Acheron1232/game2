export const GAME_FPS = 120;
export const MENU_FPS = 30;

/** Preserve native display detail, including Retina, without a pixel-budget downscale. */
export function renderScale(pixelRatio: number): number {
  return 1 / (pixelRatio || 1);
}

/** Shortest gap between skeleton pose updates. 12 ms keeps an even every-second-frame
 * rhythm at 120 FPS despite frame-time jitter, and updates every frame at 60–80 FPS. */
export const ANIMATION_MIN_STEP_MS = 12;
