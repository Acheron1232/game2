export const GAME_FPS = 120;
export const MENU_FPS = 30;

/** Preserve native display detail, including Retina, without a pixel-budget downscale. */
export function renderScale(pixelRatio: number): number {
  return 1 / (pixelRatio || 1);
}
