import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_URL, useAuth } from "./AuthContext";
import { attendanceCalendarMonth, mesaimExclusiveUntilCheckIn } from "../utils/attendanceSelf";

const POLL_MS = 20_000;

const MesaimGateContext = createContext(null);

/** Personel çıkış sonrası / giriş öncesi yalnızca Mesaim erişimi (web). */
export function MesaimGateProvider({ children }) {
  const { user, authenticated } = useAuth();
  const [today, setToday] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!authenticated || !user?.employee_id) {
      setToday(null);
      setReady(true);
      return;
    }
    try {
      const month = attendanceCalendarMonth();
      const r = await axios.get(`${API_URL}/personnel/attendance/me`, {
        params: { month },
        withCredentials: true,
      });
      setToday(r.data?.today || null);
    } catch {
      /* son bilinen kalsın */
    } finally {
      setReady(true);
    }
  }, [authenticated, user?.employee_id]);

  useEffect(() => {
    setReady(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authenticated || !user?.employee_id) return undefined;
    const id = setInterval(() => { refresh(); }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [authenticated, refresh, user?.employee_id]);

  const locked = mesaimExclusiveUntilCheckIn(user, today);
  const value = useMemo(() => ({ locked, today, ready, refresh }), [locked, today, ready, refresh]);
  return <MesaimGateContext.Provider value={value}>{children}</MesaimGateContext.Provider>;
}

export function useMesaimGate() {
  const ctx = useContext(MesaimGateContext);
  if (!ctx) {
    return { locked: false, today: null, ready: true, refresh: async () => {} };
  }
  return ctx;
}
