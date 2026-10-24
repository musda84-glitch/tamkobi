import { useEffect, useState } from "react";
import { isOnline } from "../offline/policy";

/** Giriş yapılmamış ekranda yalnız gerçek çevrimdışıyı bildirir. Senkron özeti yok. */
export default function GuestOfflineNotice() {
  const [online, setOnline] = useState(() => isOnline());

  useEffect(() => {
    const sync = () => setOnline(isOnline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  if (online) return null;

  return (
    <div
      className="sticky top-0 z-50 w-full border-b border-amber-300 bg-amber-50 px-3 pb-2 text-center text-xs font-semibold leading-snug text-amber-950 pt-[max(0.5rem,env(safe-area-inset-top,0px))]"
      data-testid="guest-offline-notice"
      role="status"
      aria-live="polite"
    >
      İnternet bağlantısı yok. Giriş için bağlantı gerekir.
    </div>
  );
}
