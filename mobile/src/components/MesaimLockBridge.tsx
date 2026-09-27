import { useMesaimGate } from "@/auth/MesaimGateContext";
import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";

/** Kilitliyken Mesaim dışındaki rotaları /mesai'ye yönlendir. */
export function MesaimLockBridge() {
  const { locked, ready } = useMesaimGate();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !locked) return;
    const path = String(pathname || "");
    if (path === "/mesai" || path.startsWith("/mesai/")) return;
    // Hesap menüsü / çıkış için bildirimler serbest değil — yalnızca Mesaim
    router.replace("/mesai");
  }, [locked, ready, pathname, router]);

  return null;
}
