/** Extra space under form content so the focused field can sit above the keyboard. */
export const SCREEN_BASE_PAD = 48;

/** Android edge-to-edge overlays the IME; iOS is handled by KeyboardAvoidingView / insets. */
export function contentBottomPad(base: number, keyboardHeight: number, platform: string): number {
  const kb = Number(keyboardHeight) || 0;
  if (platform === "android" && kb > 0) return base + kb;
  return base;
}
