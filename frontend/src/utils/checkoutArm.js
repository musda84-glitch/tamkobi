/** Mesaim çıkış: yanlışlıkla basmayı önlemek için çift tıklama penceresi (ms). */
export const CHECKOUT_ARM_MS = 2500;

/**
 * Çıkış tıklamasını işler.
 * @returns {"arm"|"fire"|"ignore"}
 */
export function resolveCheckoutClick({ armed, canCheckout }) {
  if (!canCheckout) return "ignore";
  if (!armed) return "arm";
  return "fire";
}
