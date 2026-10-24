import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { haltLocationBackground, resumeLocationBackground } from "../utils/locationBackgroundSync";
import { isShopfloorDevice } from "../utils/shopfloorDevice";

/** Oturum açılınca kayıtlı konum takibini arka planda sürdürmeye çalışır. */
export function LocationBgBridge() {
  const { token, sessionKind, user } = useAuth();
  useEffect(() => {
    if (!token || sessionKind === "b2b" || isShopfloorDevice(user)) {
      void haltLocationBackground();
      return;
    }
    void resumeLocationBackground();
  }, [sessionKind, token, user]);
  return null;
}
