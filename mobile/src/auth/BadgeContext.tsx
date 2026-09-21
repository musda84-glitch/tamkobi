import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { get } from "../api/client";
import { liveBadgeCounts, unreadFromBadges } from "../utils/notifications";
import { setAppIconBadge } from "../utils/pushRegister";
import { useAuth } from "./AuthContext";

const POLL_MS = 30000;

export type LiveBadges = Record<string, number>;

type BadgeContextValue = {
  live: LiveBadges;
  unread: number;
  refresh: () => Promise<void>;
};

const BadgeContext = createContext<BadgeContextValue | null>(null);

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const { client, companyId, token, sessionKind } = useAuth();
  const [live, setLive] = useState<LiveBadges>({});
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId || !token || sessionKind === "b2b") {
      setLive({});
      setUnread(0);
      await setAppIconBadge(0);
      return;
    }
    try {
      const data = await get<Record<string, unknown>>(client, "/dashboard/tile-badges", { company_id: companyId });
      const next = liveBadgeCounts(data);
      const nextUnread = unreadFromBadges(data);
      setLive(next);
      setUnread(nextUnread);
      await setAppIconBadge(nextUnread);
    } catch {
      /* son bilinen rozet kalsın */
    }
  }, [client, companyId, sessionKind, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token || sessionKind === "b2b") return;
    const id = setInterval(() => { refresh(); }, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refresh, sessionKind, token]);

  const value = useMemo(() => ({ live, unread, refresh }), [live, unread, refresh]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useBadges(): BadgeContextValue {
  const ctx = useContext(BadgeContext);
  if (!ctx) {
    return { live: {}, unread: 0, refresh: async () => { /* provider yok */ } };
  }
  return ctx;
}
