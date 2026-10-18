import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, View, useWindowDimensions } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import type { ActionTile } from "../components/ActionTiles";
import { HomeOverviewPage } from "../components/home/HomeOverviewPage";
import { HomeTilesPage } from "../components/home/HomeTilesPage";
import { Screen } from "../components/kit";
import { goHref } from "../nav";
import { colors } from "../theme";
import type { DashboardStats, ManagerSummary, Notification, Overview } from "../types";
import { visibleHomeTasks } from "../utils/dashboard";
import { requestConfirm } from "../utils/confirmDialog";
import {
  HOME_QUICK_EXTRA_KEY,
  HOME_QUICK_HIDDEN_KEY,
  filterHomeQuickTiles,
  hideQuickTile,
  parseExtraTileIds,
  parseHiddenTileIds,
  removeExtraTile,
  serializeExtraTileIds,
  serializeHiddenTileIds,
} from "../utils/homeQuickHidden";
import { readHomeStartPage, startPageIndex } from "../utils/homeStartPage";
import { idOf } from "../utils/money";
import { resolveMediaUrl } from "../utils/media";
import {
  MISSING_RECORD,
  NOTIFICATIONS_CLEAR_PATH,
  NOTIFICATIONS_READ_ALL_PATH,
  notificationClearableCount,
  notificationDeletePath,
  notificationOpenPlan,
  notificationRoute,
  tileBadges,
  unreadCount,
  visibleNotifications,
} from "../utils/notifications";
import { hasSelfPersonnelRecord, showHomeApprovals, showHomeFinanceSummary, showHomeRefreshTile } from "../utils/permissions";
import { splitNotificationsTile, visibleQuickTiles, type QuickTile } from "../utils/quickMenu";

export function HomeScreen() {
  const { client, companyId, user, license, activeCompany, baseUrl } = useAuth();
  const { live, refresh: refreshBadges } = useBadges();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<{ scrollTo: (opts: { x: number; y: number; animated?: boolean }) => void } | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [manager, setManager] = useState<ManagerSummary | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [openTasks, setOpenTasks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [clearingNotes, setClearingNotes] = useState(false);
  const [startReady, setStartReady] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [dotsHeight, setDotsHeight] = useState(0);

  const showFinance = showHomeFinanceSummary(user);
  const showRefresh = showHomeRefreshTile(user);
  const showApprovals = showHomeApprovals(user);
  const role = (user?.role || "").toLowerCase();
  const showMessages = hasSelfPersonnelRecord(user) || role === "admin" || role === "manager";
  const { tiles, notifications } = useMemo(
    () => splitNotificationsTile(visibleQuickTiles(user, license)),
    [user, license]
  );
  const visibleTiles = useMemo(() => filterHomeQuickTiles(tiles, hiddenIds, extraIds), [tiles, hiddenIds, extraIds]);

  const badges = useMemo(() => tileBadges(notes, { ...live, my_tasks: openTasks }), [notes, live, openTasks]);

  const persistHomePrefs = useCallback(async (hidden: string[], extras: string[]) => {
    setHiddenIds(hidden);
    setExtraIds(extras);
    await Promise.all([
      AsyncStorage.setItem(HOME_QUICK_HIDDEN_KEY, serializeHiddenTileIds(hidden)).catch(() => null),
      AsyncStorage.setItem(HOME_QUICK_EXTRA_KEY, serializeExtraTileIds(extras)).catch(() => null),
    ]);
  }, []);

  const askHideTile = useCallback(async (tile: QuickTile) => {
    const ok = await requestConfirm(
      "Karo gizlensin mi?",
      `"${tile.label}" ana ekrandan kaldırılsın. Daha menüsünden tekrar ekleyebilirsiniz.`,
      "Gizle",
    );
    if (!ok) return;
    if (tile.optIn) {
      await persistHomePrefs(hiddenIds, removeExtraTile(extraIds, tile.id));
    } else {
      await persistHomePrefs(hideQuickTile(hiddenIds, tile.id), extraIds);
    }
  }, [extraIds, hiddenIds, persistHomePrefs]);

  const quickItems: ActionTile[] = useMemo(
    () => visibleTiles.map((tile) => ({
      key: tile.id,
      label: tile.label,
      icon: tile.icon as ActionTile["icon"],
      tone: tile.tone,
      badge: badges[tile.id],
      testID: `home-quick-${tile.id}`,
      onPress: () => goHref(tile.href),
      onLongPress: () => { void askHideTile(tile); },
    })),
    [visibleTiles, badges, askHideTile]
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setRefreshing(true);
    try {
      const staff = hasSelfPersonnelRecord(user);
      const [ov, list, st, me, mgr] = await Promise.all([
        get<Overview>(client, "/dashboard/overview", { company_id: companyId }),
        get<Notification[]>(client, "/notifications", { company_id: companyId }).catch(() => []),
        showFinance
          ? get<DashboardStats>(client, "/dashboard/stats", { company_id: companyId }).catch(() => null)
          : Promise.resolve(null),
        staff
          ? get<{ tasks?: { done?: boolean }[]; work_orders?: unknown[] }>(client, "/personnel/me").catch(() => null)
          : Promise.resolve(null),
        showFinance
          ? get<ManagerSummary>(client, "/dashboard/manager-summary", { company_id: companyId }).catch(() => null)
          : Promise.resolve(null),
        refreshBadges(),
      ]);
      const openMine = (me?.tasks || []).filter((t) => !t.done).length;
      setOpenTasks(openMine);
      const homeTasks = visibleHomeTasks(ov?.tasks, user, {
        openTasks: openMine,
        openWorkOrders: (me?.work_orders || []).length,
      });
      setOverview(ov ? { ...ov, tasks: homeTasks } : ov);
      setNotes(visibleNotifications(list || [], user));
      setStats(st);
      setManager(mgr);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Özet yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, refreshBadges, showFinance, user]);

  useFocusEffect(useCallback(() => {
    Promise.all([
      AsyncStorage.getItem(HOME_QUICK_HIDDEN_KEY).catch(() => null),
      AsyncStorage.getItem(HOME_QUICK_EXTRA_KEY).catch(() => null),
    ]).then(([hiddenRaw, extraRaw]) => {
      setHiddenIds(parseHiddenTileIds(hiddenRaw));
      setExtraIds(parseExtraTileIds(extraRaw));
    });
    load();
  }, [load]));

  useEffect(() => {
    if (!showFinance) return undefined;
    let live = true;
    readHomeStartPage(String(user?.id || ""), String(companyId || "")).then((mode) => {
      if (!live) return;
      const index = startPageIndex(mode);
      setStartIndex(index);
      setPage(index);
      setStartReady(true);
    });
    return () => { live = false; };
  }, [showFinance, user?.id, companyId]);

  useEffect(() => {
    if (!showFinance || !startReady || width <= 0) return;
    pagerRef.current?.scrollTo({ x: startIndex * width, y: 0, animated: false });
  }, [showFinance, startReady, startIndex, width]);

  const openNotification = useCallback(async (n: Notification) => {
    const id = idOf(n);
    if (id && !n.is_read) {
      setNotes((prev) => prev.map((x) => (idOf(x) === id ? { ...x, is_read: true } : x)));
      post(client, `/notifications/${id}/read`, {}).catch(() => { /* okundu işareti kritik değil */ });
      refreshBadges();
    }
    let plan = notificationOpenPlan(null, n);
    if (id) {
      try {
        const res = await get<{ exists?: boolean; target?: { route?: string } }>(client, `/notifications/${id}/target`);
        plan = notificationOpenPlan(res, n);
      } catch {
        /* yerel rota */
      }
    }
    if (plan.missing) {
      Alert.alert(MISSING_RECORD);
      return;
    }
    goHref(plan.href || notificationRoute(n) || "/notifications");
  }, [client, refreshBadges]);

  const markAllRead = useCallback(async () => {
    if (!unreadCount(notes)) return;
    setNotes((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await post(client, NOTIFICATIONS_READ_ALL_PATH, {}, { company_id: companyId });
      refreshBadges();
    } catch (err) {
      setError(apiErrorMessage(err, "Bildirimler okundu işaretlenemedi."));
    }
  }, [client, companyId, notes, refreshBadges]);

  const deleteNotification = useCallback(async (n: Notification) => {
    const path = notificationDeletePath(n);
    if (!path) return;
    const id = idOf(n);
    setNotes((prev) => prev.filter((x) => idOf(x) !== id));
    try {
      await del(client, path);
      refreshBadges();
    } catch {
      /* liste bir sonraki yenilemede toparlanır */
    }
  }, [client, refreshBadges]);

  const clearAllNotifications = useCallback(async () => {
    if (!companyId || !notificationClearableCount(notes) || clearingNotes) return;
    const ok = await requestConfirm(
      "Tümünü sil",
      "Görünen tüm bildirimler silinecek. Bu işlem geri alınamaz.",
      "Tümünü sil",
    );
    if (!ok) return;
    setClearingNotes(true);
    const prev = notes;
    setNotes([]);
    try {
      await post(client, NOTIFICATIONS_CLEAR_PATH, {}, { company_id: companyId });
      refreshBadges();
    } catch (err) {
      setNotes(prev);
      setError(apiErrorMessage(err, "Bildirimler silinemedi."));
    } finally {
      setClearingNotes(false);
    }
  }, [clearingNotes, client, companyId, notes, refreshBadges]);

  const tilesPage = (
    <HomeTilesPage
      error={error}
      quickItems={quickItems}
      showRefresh={showRefresh}
      refreshing={refreshing}
      onRefresh={load}
      showApprovals={showApprovals}
      client={client}
      companyId={companyId}
      onBadgesChanged={refreshBadges}
      showMessages={showMessages}
      notifications={notifications}
      notes={notes}
      clearingNotes={clearingNotes}
      onOpenAllNotes={() => { if (notifications) goHref(notifications.href); }}
      onOpenNote={(n) => { void openNotification(n); }}
      onDeleteNote={(n) => { void deleteNotification(n); }}
      onClearNotes={() => { void clearAllNotifications(); }}
      onMarkAllRead={() => { void markAllRead(); }}
      showFinance={showFinance}
      stats={stats}
      overview={overview}
    />
  );

  if (!showFinance) {
    return (
      <Screen onRefresh={load} refreshing={refreshing}>
        {tilesPage}
      </Screen>
    );
  }

  if (!startReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  const pageOffset = startIndex * width;
  const pageHeight = frameHeight > dotsHeight ? frameHeight - dotsHeight : 0;
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      onLayout={(e) => {
        const next = Math.round(e.nativeEvent.layout.height);
        setFrameHeight((prev) => (prev === next ? prev : next));
      }}
    >
      <ScrollView
        ref={pagerRef as never}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        testID="home-pager"
        style={{ height: pageHeight || undefined, flex: pageHeight ? undefined : 1 }}
        contentOffset={{ x: pageOffset, y: 0 }}
        onMomentumScrollEnd={(e) => {
          if (width <= 0) return;
          const x = e?.nativeEvent?.contentOffset?.x ?? 0;
          const next = Math.max(0, Math.min(1, Math.round(x / width)));
          setPage(next);
        }}
      >
        <View style={{ width, height: pageHeight || undefined }} testID="home-page-overview">
          <Screen onRefresh={load} refreshing={refreshing}>
            <HomeOverviewPage
              userName={user?.name}
              companyName={activeCompany?.name}
              logoUrl={resolveMediaUrl(baseUrl, activeCompany?.logo_url) || null}
              user={user}
              stats={stats}
              overview={overview}
              manager={manager}
            />
          </Screen>
        </View>
        <View style={{ width, height: pageHeight || undefined }} testID="home-page-tiles">
          <Screen onRefresh={load} refreshing={refreshing}>
            {tilesPage}
          </Screen>
        </View>
      </ScrollView>
      <View
        testID="home-pager-dots"
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.height);
          setDotsHeight((prev) => (prev === next ? prev : next));
        }}
        style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingTop: 4, paddingBottom: 8 }}
      >
        {[0, 1].map((i) => (
          <View
            key={i}
            testID={`home-pager-dot-${i}`}
            accessibilityLabel={i === 0 ? "Genel Bakış" : "Butonlar"}
            style={{
              width: page === i ? 16 : 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: page === i ? colors.primary : colors.slate200,
            }}
          />
        ))}
      </View>
    </View>
  );
}
