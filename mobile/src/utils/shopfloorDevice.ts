/** Atölye kiosk cihazı. Kod ve token adres parametresine veya loga yazılmaz. */

export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{6}$`);

export function isShopfloorDevice(user: { account_type?: string; role?: string } | null | undefined): boolean {
  if (!user) return false;
  const kind = String(user.account_type || "").trim().toLowerCase();
  const role = String(user.role || "").trim().toLowerCase();
  return kind === "atolye_device" || role === "atolye_device";
}

export function shopfloorDeviceMayOpen(pathname: string): boolean {
  const path = String(pathname || "/").split("?")[0].replace(/\/+$/, "") || "/";
  return path === "/atolye" || path === "/atolye/index";
}

export function normalizePairingCode(raw: unknown): string {
  const text = String(raw ?? "").trim().toUpperCase();
  return CODE_RE.test(text) ? text : "";
}

export function scrubPairingCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(new RegExp(`[^${PAIRING_CODE_ALPHABET}]`, "g"), "")
    .slice(0, 6);
}

type PairResponse = { token?: unknown };

/** Düz kodu sunucuya yollar. Dönüş cihaz token'ıdır; kod yanıtta saklanmaz. */
export async function requestDevicePair(
  postFn: (path: string, body: { code: string }) => Promise<PairResponse>,
  raw: unknown,
): Promise<string> {
  const code = normalizePairingCode(raw);
  if (!code) throw new Error("Kod 6 karakter olmalı.");
  const res = await postFn("/shopfloor/devices/pair", { code });
  const token = String(res?.token || "").trim();
  if (!token) throw new Error("Eşleştirme yanıtı geçersiz.");
  return token;
}
