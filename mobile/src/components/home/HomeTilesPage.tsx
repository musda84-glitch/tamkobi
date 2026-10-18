import React from "react";
import { Pressable, Text, View } from "react-native";
import type { ApiClient } from "../../api/client";
import { ActionTiles, type ActionTile } from "../ActionTiles";
import { Badge, Card, ErrorBanner, Muted, Row, StatRows } from "../kit";
import { ManagerApprovalsPanel } from "../ManagerApprovalsPanel";
import { NotificationsPanel } from "../NotificationsPanel";
import { StaffMessagesPanel } from "../StaffMessagesPanel";
import { goHref } from "../../nav";
import { colors } from "../../theme";
import type { DashboardStats, Notification, Overview } from "../../types";
import { monthlySalesRow, netProfitRow } from "../../utils/dashboard";
import { fmtMoney } from "../../utils/money";
import { latestNotifications, unreadCount } from "../../utils/notifications";
import { resolveMobilePath, type QuickTile } from "../../utils/quickMenu";

/** Sayfa 1: mevcut ana ekran gövdesi. Stil ve karo davranışı aynı kalır. */
export function HomeTilesPage({
  error,
  quickItems,
  showRefresh,
  refreshing,
  onRefresh,
  showApprovals,
  client,
  companyId,
  onBadgesChanged,
  showMessages,
  notifications,
  notes,
  clearingNotes,
  onOpenAllNotes,
  onOpenNote,
  onDeleteNote,
  onClearNotes,
  onMarkAllRead,
  showFinance,
  stats,
  overview,
}: {
  error: string | null;
  quickItems: ActionTile[];
  showRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  showApprovals: boolean;
  client: ApiClient;
  companyId: string;
  onBadgesChanged: () => void;
  showMessages: boolean;
  notifications: QuickTile | null;
  notes: Notification[];
  clearingNotes: boolean;
  onOpenAllNotes: () => void;
  onOpenNote: (n: Notification) => void;
  onDeleteNote: (n: Notification) => void;
  onClearNotes: () => void;
  onMarkAllRead: () => void;
  showFinance: boolean;
  stats: DashboardStats | null;
  overview: Overview | null;
}) {
  const profitRow = netProfitRow(stats);
  return (
    <>
      <ErrorBanner message={error} />

      <View testID="home-quick-menu">
        <ActionTiles
          size="md"
          items={[
            ...quickItems,
            ...(showRefresh ? [{
              key: "refresh",
              label: "Yenile",
              icon: "refresh" as const,
              tone: "slate" as const,
              testID: "home-quick-refresh",
              onPress: onRefresh,
              busy: refreshing,
            }] : []),
          ]}
        />
        {showApprovals ? (
          <View style={{ marginTop: 8 }}>
            <ManagerApprovalsPanel client={client} companyId={companyId} onChanged={onBadgesChanged} />
          </View>
        ) : null}
        {showMessages ? (
          <View style={{ marginTop: 8 }}>
            <StaffMessagesPanel client={client} onChanged={onBadgesChanged} />
          </View>
        ) : null}
        {notifications ? (
          <View style={{ marginTop: 4 }}>
            <NotificationsPanel
              items={latestNotifications(notes)}
              unread={unreadCount(notes)}
              totalCount={notes.length}
              clearing={clearingNotes}
              onOpenAll={onOpenAllNotes}
              onOpenItem={onOpenNote}
              onDeleteItem={onDeleteNote}
              onClearAll={onClearNotes}
              onMarkAllRead={onMarkAllRead}
            />
          </View>
        ) : null}
      </View>

      {showFinance ? (
        <StatRows
          testID="home-summary"
          items={[
            { key: "sales", ...monthlySalesRow(stats, overview) },
            ...(profitRow ? [{ key: "profit", ...profitRow, valueColor: (stats?.net_profit ?? 0) < 0 ? colors.danger : colors.primaryHover }] : []),
            { key: "collections", label: "Tahsilat", value: fmtMoney(overview?.collections.total), hint: `Gecikmiş ${fmtMoney(overview?.collections.overdue)}` },
            { key: "payments", label: "Ödeme", value: fmtMoney(overview?.payments.total), hint: `Gecikmiş ${fmtMoney(overview?.payments.overdue)}` },
            { key: "vat", label: "KDV ödenecek", value: fmtMoney(overview?.vat.payable), hint: `${overview?.vat.days_left ?? "—"} gün` },
          ]}
        />
      ) : null}
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
    </>
  );
}
