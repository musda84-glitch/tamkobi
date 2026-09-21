export const SWIPE_MENU_W = 144;
export const SWIPE_TAP_PX = 8;

/** Kaydırma bitince menü mü açılsın, kapansın, yoksa satır tıklansın. */
export function swipeRevealOutcome(startX: number, dx: number, vx: number): "open" | "close" | "press" {
  if (Math.abs(dx) < SWIPE_TAP_PX && Math.abs(vx) < 0.25) {
    return startX < -10 ? "close" : "press";
  }
  const next = startX + dx;
  if (next < -SWIPE_MENU_W / 2 || vx < -0.4) return "open";
  return "close";
}
