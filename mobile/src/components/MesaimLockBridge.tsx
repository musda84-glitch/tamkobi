import { useMesaimGate } from "@/auth/MesaimGateContext";
import { mesaimLockAllowsPath, mesaimLockHomePath } from "@/utils/attendanceSelf";
import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";

/** Kilitliyken Özet ve Mesaim dışındaki rotaları Özet'e yönlendir. */
export function MesaimLockBridge() {
  const { locked, ready } = useMesaimGate();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !locked) return;
    if (mesaimLockAllowsPath(pathname)) return;
    router.replace(mesaimLockHomePath());
  }, [locked, ready, pathname, router]);

  return null;
}
