import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { haltLocationBackground, resumeLocationBackground } from "../utils/locationBackgroundSync";

/** Oturum açılınca kayıtlı konum takibini arka planda sürdürmeye çalışır. */
export function LocationBgBridge() {
  const { token, sessionKind } = useAuth();
  useEffect(() => {
    if (!token || sessionKind === "b2b") {
      void haltLocationBackground();
      return;
    }
    void resumeLocationBackground();
  }, [sessionKind, token]);
  return null;
}
