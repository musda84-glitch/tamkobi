/** Extra space under form content so the focused field can sit above the keyboard. */
export const SCREEN_BASE_PAD = 48;
export const KEYBOARD_FIELD_GAP = 24;

/** Android / web overlay the IME; iOS is handled by KeyboardAvoidingView / insets. */
export function contentBottomPad(base: number, keyboardHeight: number, platform: string): number {
  const kb = Number(keyboardHeight) || 0;
  if (kb > 0 && platform !== "ios") return base + kb;
  return base;
}

/** Pixels to scroll so the focused field sits in the band above the keyboard. */
export function focusedFieldScrollDelta(inputBottom: number, keyboardTop: number, extra = KEYBOARD_FIELD_GAP): number {
  const bottom = Number(inputBottom) || 0;
  const top = Number(keyboardTop) || 0;
  if (bottom <= 0 || top <= 0) return 0;
  const need = bottom + extra - top;
  return need > 0 ? Math.round(need) : 0;
}

export function nextScrollY(currentY: number, delta: number, maxY?: number): number {
  const y = Math.max(0, (Number(currentY) || 0) + (Number(delta) || 0));
  if (maxY != null && Number.isFinite(Number(maxY))) return Math.min(y, Math.max(0, Number(maxY)));
  return y;
}

export function keyboardTopFromEvent(screenY?: number, height?: number, windowHeight?: number): number {
  if (screenY != null && Number(screenY) > 0) return Number(screenY);
  const wh = Number(windowHeight) || 0;
  const h = Number(height) || 0;
  return wh > 0 && h > 0 ? wh - h : 0;
}

export function keyboardTopFromVisualViewport(innerHeight: number, visualHeight?: number, offsetTop?: number): number {
  const inner = Number(innerHeight) || 0;
  const vh = visualHeight != null && Number.isFinite(Number(visualHeight)) ? Number(visualHeight) : inner;
  const off = Number(offsetTop) || 0;
  return off + vh;
}

export function webKeyboardHeight(innerHeight: number, visualHeight?: number, offsetTop?: number): number {
  const inner = Number(innerHeight) || 0;
  const covered = inner - keyboardTopFromVisualViewport(inner, visualHeight, offsetTop);
  return covered > 80 ? covered : 0;
}

/** Login card: closed keyboard stays centered; open keyboard pins the sheet above the IME. */
export function loginSheetJustify(keyboardHeight: number): "center" | "flex-end" {
  return (Number(keyboardHeight) || 0) > 0 ? "flex-end" : "center";
}

/** Bottom-sheet overlay inset so the composer sits above the IME (iOS uses KeyboardAvoidingView). */
export function sheetBottomInset(keyboardHeight: number, platform: string): number {
  const lift = contentBottomPad(0, keyboardHeight, platform);
  return lift > 0 ? lift + 8 : 0;
}
