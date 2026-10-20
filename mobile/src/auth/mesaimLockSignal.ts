/** client.ts hata yolu MesaimGate'e bağlanır; döngüsel import yok. */

let refreshLocked: (() => void) | null = null;

export function bindMesaimGateRefresh(fn: (() => void) | null): void {
  refreshLocked = fn;
}

export function notifyMesaimLocked(): void {
  refreshLocked?.();
}

export function isMesaimLockedBody(data: unknown): boolean {
  return Boolean(data && typeof data === "object" && (data as { code?: unknown }).code === "mesaim_locked");
}
