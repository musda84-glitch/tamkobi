import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { get } from "../api/client";
import { attendanceCalendarMonth, mesaimExclusiveUntilCheckIn } from "../utils/attendanceSelf";
import { useAuth } from "./AuthContext";

const POLL_MS = 20_000;

type TodayPunch = {
  check_in?: string | null;
  check_out?: string | null;
} | null;

type MesaimGateValue = {
  locked: boolean;
  today: TodayPunch;
  ready: boolean;
  refresh: () => Promise<void>;
};

const MesaimGateContext = createContext<MesaimGateValue | null>(null);

type MeLite = {
  employee?: { id?: string } | null;
  today?: TodayPunch;
};

/** Personel çıkış sonrası / giriş öncesi yalnızca Mesaim erişimi. */
export function MesaimGateProvider({ children }: { children: React.ReactNode }) {
  const { client, companyId, token, sessionKind, user } = useAuth();
  const [today, setToday] = useState<TodayPunch>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !token || sessionKind === "b2b" || !user?.employee_id) {
      setToday(null);
      setReady(true);
      return;
    }
    try {
      const month = attendanceCalendarMonth();
      const data = await get<MeLite>(client, "/personnel/attendance/me", { company_id: companyId, month });
      setToday(data?.today || null);
    } catch {
      /* son bilinen durum kalsın */
    } finally {
      setReady(true);
    }
  }, [client, companyId, sessionKind, token, user?.employee_id]);

  useEffect(() => {
    setReady(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token || sessionKind === "b2b" || !user?.employee_id) return;
    const id = setInterval(() => { refresh(); }, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refresh, sessionKind, token, user?.employee_id]);

  const locked = mesaimExclusiveUntilCheckIn(user, today);
  const value = useMemo(
    () => ({ locked, today, ready, refresh }),
    [locked, today, ready, refresh],
  );
  return <MesaimGateContext.Provider value={value}>{children}</MesaimGateContext.Provider>;
}

export function useMesaimGate(): MesaimGateValue {
  const ctx = useContext(MesaimGateContext);
  if (!ctx) {
    return { locked: false, today: null, ready: true, refresh: async () => { /* provider yok */ } };
  }
  return ctx;
}
