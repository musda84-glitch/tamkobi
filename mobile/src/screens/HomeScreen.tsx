import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useBadges } from "../auth/BadgeContext";
import type { ActionTile } from "../components/ActionTiles";
import { HomeOverviewPage } from "../components/home/HomeOverviewPage";
import { HomeOverviewReorder, triggerReorderHaptic } from "../components/home/HomeOverviewReorder";
import { HomePanels, type HomePanelProps } from "../components/home/HomePanels";
import { HomeTilesPage } from "../components/home/HomeTilesPage";
import { DEFAULT_OVERVIEW_SECTION_ORDER, type OverviewSectionKey } from "../components/home/overviewSections";
import { Badge, Card, Muted, Row, Screen } from "../components/kit";
import { goHref } from "../nav";
import { colors } from "../theme";
import type { DashboardStats, ManagerSummary, Notification, Overview } from "../types";
import { visibleHomeTasks } from "../utils/dashboard";
import { requestConfirm } from "../utils/confirmDialog";
import {
  HOME_QUICK_EXTRA_KEY,
  HOME_QUICK_HIDDEN_KEY,
  addExtraTile,
  filterHomeQuickTiles,
  hideQuickTile,
  isTileOnHome,
  parseExtraTileIds,
  parseHiddenTileIds,
  removeExtraTile,
  restoreQuickTile,
  serializeExtraTileIds,
  serializeHiddenTileIds,
} from "../utils/homeQuickHidden";
import { isDefaultOverviewOrder, normalizeOverviewOrder, readHomeOverviewOrder, resetHomeOverviewOrder, writeHomeOverviewOrder } from "../utils/homeOverviewOrder";
import {
  isDefaultQuickOrder,
  moveQuickTile,
  readHomeQuickOrder,
  reconcileQuickOrder,
  resetHomeQuickOrder,
  writeHomeQuickOrder,
} from "../utils/homeQuickOrder";
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
import { resolveMobilePath, splitNotificationsTile, visibleQuickTiles, type QuickTile } from "../utils/quickMenu";

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
  const [overviewOrder, setOverviewOrder] = useState<OverviewSectionKey[]>(() => [...DEFAULT_OVERVIEW_SECTION_ORDER]);
  const [overviewOrderScope, setOverviewOrderScope] = useState("");
  const [reordering, setReordering] = useState(false);
  const [draftOrder, setDraftOrder] = useState<OverviewSectionKey[]>(() => [...DEFAULT_OVERVIEW_SECTION_ORDER]);
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [tileOrderScope, setTileOrderScope] = useState("");
  const [tileReordering, setTileReordering] = useState(false);
  const [tileDraft, setTileDraft] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [dotsHeight, setDotsHeight] = useState(0);

  const showFinance = showHomeFinanceSummary(user);
  const overviewScope = `${String(user?.id || "")}:${String(companyId || "")}`;
  const overviewScopeRef = useRef(overviewScope);
  overviewScopeRef.current = overviewScope;
  const settledOverviewScope = useRef(overviewScope);
  const visibleOverviewOrder = overviewOrderScope === overviewScope ? overviewOrder : DEFAULT_OVERVIEW_SECTION_ORDER;
  const showRefresh = showHomeRefreshTile(user);
  const showApprovals = showHomeApprovals(user);
  const role = (user?.role || "").toLowerCase();
  const showMessages = hasSelfPersonnelRecord(user) || role === "admin" || role === "manager";
  const { tiles, notifications } = useMemo(
    () => splitNotificationsTile(visibleQuickTiles(user, license)),
    [user, license]
  );
  const visibleTiles = useMemo(() => filterHomeQuickTiles(tiles, hiddenIds, extraIds), [tiles, hiddenIds, extraIds]);
  const allowedIds = useMemo(() => tiles.map((tile) => tile.id), [tiles]);
  const tileById = useMemo(() => {
    const map = new Map<string, QuickTile>();
    for (const tile of tiles) map.set(tile.id, tile);
    return map;
  }, [tiles]);
  const appliedTileOrder = useMemo(
    () => reconcileQuickOrder(tileOrderScope === overviewScope ? tileOrder : [], allowedIds),
    [allowedIds, overviewScope, tileOrder, tileOrderScope],
  );
  const orderedVisible = useMemo(
    () => appliedTileOrder
      .map((id) => tileById.get(id))
      .filter((tile): tile is QuickTile => Boolean(tile) && isTileOnHome(tile, hiddenIds, extraIds)),
    [appliedTileOrder, extraIds, hiddenIds, tileById],
  );

  const badges = useMemo(() => tileBadges(notes, { ...live, my_tasks: openTasks }), [notes, live, openTasks]);

  const persistHomePrefs = useCallback(async (hidden: string[], extras: string[]) => {
    setHiddenIds(hidden);
    setExtraIds(extras);
    await Promise.all([
      AsyncStorage.setItem(HOME_QUICK_HIDDEN_KEY, serializeHiddenTileIds(hidden)).catch(() => null),
      AsyncStorage.setItem(HOME_QUICK_EXTRA_KEY, serializeExtraTileIds(extras)).catch(() => null),
    ]);
  }, []);

  const hideTileNow = useCallback(async (tile: QuickTile) => {
    if (tile.optIn) {
      await persistHomePrefs(hiddenIds, removeExtraTile(extraIds, tile.id));
    } else {
      await persistHomePrefs(hideQuickTile(hiddenIds, tile.id), extraIds);
    }
  }, [extraIds, hiddenIds, persistHomePrefs]);

  const showQuickTile = useCallback(async (tile: QuickTile) => {
    if (tile.optIn) {
      await persistHomePrefs(hiddenIds, addExtraTile(extraIds, tile.id));
    } else {
      await persistHomePrefs(restoreQuickTile(hiddenIds, tile.id), extraIds);
    }
  }, [extraIds, hiddenIds, persistHomePrefs]);

  const askHideTile = useCallback(async (tile: QuickTile) => {
    const ok = await requestConfirm(
      "Karo gizlensin mi?",
      `"${tile.label}" ana ekrandan kaldırılsın. Daha menüsünden tekrar ekleyebilirsiniz.`,
      "Gizle",
    );
    if (!ok) return;
    await hideTileNow(tile);
  }, [hideTileNow]);

  const askTileMenu = useCallback((tile: QuickTile) => {
    Alert.alert(
      "Karo gizlensin mi?",
      `"${tile.label}" ana ekrandan kaldırılsın. Daha menüsünden tekrar ekleyebilirsiniz.`,
      [
        { text: "Gizle", onPress: () => { void hideTileNow(tile); } },
        {
          text: "Yerini değiştir",
          onPress: () => {
            if (reordering || tileOrderScope !== overviewScope) return;
            triggerReorderHaptic();
            setTileDraft(reconcileQuickOrder(tileOrder, allowedIds));
            setTileReordering(true);
            setPage(1);
            if (width > 0) pagerRef.current?.scrollTo({ x: width, y: 0, animated: true });
          },
        },
        { text: "Vazgeç", style: "cancel" },
      ],
    );
  }, [allowedIds, hideTileNow, overviewScope, reordering, tileOrder, tileOrderScope, width]);

  const toQuickAction = useCallback((tile: QuickTile, onLongPress?: () => void, onPress?: () => void): ActionTile => ({
    key: tile.id,
    label: tile.label,
    icon: tile.icon as ActionTile["icon"],
    tone: tile.tone,
    badge: badges[tile.id],
    testID: `home-quick-${tile.id}`,
    onPress: onPress ?? (() => goHref(tile.href)),
    onLongPress,
  }), [badges]);

  const plainQuickItems = useMemo(
    () => visibleTiles.map((tile) => toQuickAction(tile, () => { void askHideTile(tile); })),
    [askHideTile, toQuickAction, visibleTiles],
  );

  const financeQuickItems = useMemo(
    () => orderedVisible.map((tile) => toQuickAction(tile, () => askTileMenu(tile))),
    [askTileMenu, orderedVisible, toQuickAction],
  );

  const editItems = useMemo(() => tileDraft.flatMap((id) => {
    const tile = tileById.get(id);
    if (!tile) return [];
    const hidden = !isTileOnHome(tile, hiddenIds, extraIds);
    return [{
      ...toQuickAction(tile, undefined, hidden ? () => { void showQuickTile(tile); } : () => {}),
      badge: hidden ? undefined : badges[tile.id],
      dimmed: hidden,
    }];
  }), [badges, extraIds, hiddenIds, showQuickTile, tileById, tileDraft, toQuickAction]);

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
    if (!showFinance) return undefined;
    let live = true;
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const nextScope = `${userId}:${company}`;
    readHomeOverviewOrder(userId, company).then((order) => {
      if (!live) return;
      setOverviewOrder(order);
      setOverviewOrderScope(nextScope);
    });
    return () => { live = false; };
  }, [showFinance, user?.id, companyId]);

  useEffect(() => {
    if (!showFinance) return undefined;
    let live = true;
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const nextScope = `${userId}:${company}`;
    readHomeQuickOrder(userId, company).then((order) => {
      if (!live) return;
      setTileOrder(order);
      setTileOrderScope(nextScope);
    });
    return () => { live = false; };
  }, [showFinance, user?.id, companyId]);

  useEffect(() => {
    if (settledOverviewScope.current === overviewScope) return;
    settledOverviewScope.current = overviewScope;
    setReordering(false);
    setTileReordering(false);
  }, [overviewScope]);

  useEffect(() => {
    if (!reordering && !tileReordering) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tileReordering) {
        setTileReordering(false);
        return true;
      }
      setReordering(false);
      return true;
    });
    return () => subscription.remove();
  }, [reordering, tileReordering]);

  useEffect(() => {
    if (!tileReordering) return;
    setTileDraft((prev) => {
      const next = reconcileQuickOrder(prev, allowedIds);
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) return prev;
      return next;
    });
  }, [allowedIds, tileReordering]);

  const commitOverviewOrder = useCallback(async () => {
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const scopeAtStart = `${userId}:${company}`;
    const next = normalizeOverviewOrder(draftOrder);
    await writeHomeOverviewOrder(userId, company, next);
    if (overviewScopeRef.current !== scopeAtStart) return;
    setOverviewOrder(next);
    setOverviewOrderScope(scopeAtStart);
    setReordering(false);
  }, [companyId, draftOrder, user?.id]);

  const resetOverviewDraft = useCallback(async () => {
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const scopeAtStart = `${userId}:${company}`;
    const def = await resetHomeOverviewOrder(userId, company);
    if (overviewScopeRef.current !== scopeAtStart) return;
    setDraftOrder(def);
    setOverviewOrder(def);
  }, [companyId, user?.id]);

  const commitTileOrder = useCallback(async () => {
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const scopeAtStart = `${userId}:${company}`;
    const next = reconcileQuickOrder(tileDraft, allowedIds);
    await writeHomeQuickOrder(userId, company, next, allowedIds);
    if (overviewScopeRef.current !== scopeAtStart) return;
    setTileOrder(next);
    setTileOrderScope(scopeAtStart);
    setTileReordering(false);
  }, [allowedIds, companyId, tileDraft, user?.id]);

  const resetTileDraft = useCallback(async () => {
    const userId = String(user?.id || "");
    const company = String(companyId || "");
    const scopeAtStart = `${userId}:${company}`;
    const def = await resetHomeQuickOrder(userId, company, allowedIds);
    if (overviewScopeRef.current !== scopeAtStart) return;
    setTileDraft(def);
    setTileOrder(def);
    setTileOrderScope(scopeAtStart);
  }, [allowedIds, companyId, user?.id]);

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
      quickItems={plainQuickItems}
      showRefresh={showRefresh}
      refreshing={refreshing}
      onRefresh={load}
    />
  );

  const panelProps: HomePanelProps = {
    showApprovals,
    client,
    companyId,
    onBadgesChanged: refreshBadges,
    showMessages,
    notifications,
    notes,
    clearingNotes,
    onOpenAllNotes: () => { if (notifications) goHref(notifications.href); },
    onOpenNote: (n) => { void openNotification(n); },
    onDeleteNote: (n) => { void deleteNotification(n); },
    onClearNotes: () => { void clearAllNotifications(); },
    onMarkAllRead: () => { void markAllRead(); },
  };

  if (!showFinance) {
    return (
      <Screen onRefresh={load} refreshing={refreshing}>
        {tilesPage}
        <HomePanels {...panelProps} />
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Bugünkü işler</Text>
          {!overview?.tasks?.length ? <Muted>Bekleyen görev yok.</Muted> : overview.tasks.map((t) => {
            const href = resolveMobilePath(t.path);
            const row = (
              <Row style={{ justifyContent: "space-between", paddingVertical: 6 }}>
                <Text style={{ color: colors.text, flex: 1 }}>{t.label}{t.extra ? ` · ${t.extra}` : ""}</Text>
                <Badge label={String(t.count)} tone={t.count ? "amber" : "slate"} />
              </Row>
            );
            if (!href) return <View key={t.key}>{row}</View>;
            return (
              <Pressable key={t.key} onPress={() => goHref(href)} testID={`home-task-${t.key}`}>
                {row}
              </Pressable>
            );
          })}
        </Card>
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
        scrollEnabled={!reordering && !tileReordering}
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
          <Screen onRefresh={reordering ? undefined : load} refreshing={refreshing}>
            {reordering ? (
              <HomeOverviewReorder
                order={draftOrder}
                onChange={setDraftOrder}
                onDone={() => { void commitOverviewOrder(); }}
                onCancel={() => setReordering(false)}
                onReset={() => { void resetOverviewDraft(); }}
                resetDisabled={isDefaultOverviewOrder(draftOrder)}
              />
            ) : (
              <HomeOverviewPage
                userName={user?.name}
                companyName={activeCompany?.name}
                logoUrl={resolveMediaUrl(baseUrl, activeCompany?.logo_url) || null}
                user={user}
                stats={stats}
                overview={overview}
                manager={manager}
                {...panelProps}
                sectionOrder={visibleOverviewOrder}
                onRequestReorder={() => {
                  if (tileReordering || overviewOrderScope !== overviewScope) return;
                  triggerReorderHaptic();
                  setDraftOrder([...visibleOverviewOrder]);
                  setReordering(true);
                }}
              />
            )}
          </Screen>
        </View>
        <View style={{ width, height: pageHeight || undefined }} testID="home-page-tiles">
          <Screen onRefresh={tileReordering ? undefined : load} refreshing={refreshing}>
            <HomeTilesPage
              error={error}
              quickItems={tileReordering ? editItems : financeQuickItems}
              showRefresh={showRefresh && !tileReordering}
              refreshing={refreshing}
              onRefresh={load}
              editing={tileReordering}
              onMoveTile={(from, to) => setTileDraft((prev) => moveQuickTile(prev, from, to))}
              onDoneEdit={() => { void commitTileOrder(); }}
              onResetEdit={() => { void resetTileDraft(); }}
              resetDisabled={isDefaultQuickOrder(tileDraft, allowedIds)}
            />
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
