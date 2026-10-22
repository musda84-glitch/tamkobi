import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Image, Modal, Pressable, Switch, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { GroupedSelect } from "../components/GroupedSelect";
import { QuantityInput } from "../components/MoneyInput";
import {
  DrawingViewer,
  FilterMenu,
  FocusBoard,
  IdleLock,
  PartialCountDialog,
  TakeoverDialog,
  UndoToast,
} from "../components/ShopFloorPanels";
import { ShopfloorPinPad } from "../components/ShopfloorPinPad";
import { Badge, Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors, radius, spacing } from "../theme";
import { archivedAssignedDuties, openAssignedDuties, type AssignedDuty } from "../utils/assignedDuty";
import { resolveMediaUrl } from "../utils/media";
import { fmtDate, idOf } from "../utils/money";
import {
  filterByKpi,
  finishOverPlan,
  finishQtyError,
  formatQty,
  groupWorkOrdersByStation,
  isMine,
  operatorStationLock,
  operatorStationLockMessage,
  partitionWorkOrders,
  pausedForLabel,
  readyCount,
  roundNeededQty,
  runningCount,
  shopFloorCardBorder,
  shopFloorPausePhaseLabel,
  shopFloorStationSections,
  sortWorkOrdersByStatus,
  todayDoneCount,
  woCardKey,
  workOrderFinishPlan,
  woStatusTone,
  woStatusTr,
  workOrderQtyLabel,
  type PausePolicy,
  type ShopFloorKpiFilter,
  type WorkOrder,
} from "../utils/shopFloor";
import {
  cardTags,
  cardTitle,
  matchesLinkFilter,
  normalizeShopfloorFilters,
  projectColor,
  projectFilterLabel,
  recipeFilterLabel,
  stationColor,
} from "../utils/shopFloorCardMeta";
import {
  focusJob,
  idempotencyKey,
  normalizeScrapReasons,
  personnelCode,
  shopfloorInitials,
  shopfloorMayOperate,
  takeoverDetail,
  undoCountdown,
  type ScrapReason,
  type TakeoverDetail,
} from "../utils/shopFloorScreen";
import { trUpper } from "../utils/labels";
import {
  isAtolyeAccount,
  isOperatorSessionError,
  isSessionExpired,
  isValidPin,
  operatorHeaders,
  unlockErrorMessage,
  type ShopfloorOperatorSession,
} from "../utils/shopfloorOperatorSession";
import { stationNamesFromParks } from "../utils/workParks";

type ShopfloorOperatorRow = {
  operator_type: string;
  id: string;
  name: string;
  station?: string;
  personnel_no?: string;
  employee_code?: string;
  code?: string;
};

/** Süreç belleği (web sessionStorage karşılığı). Diske yazılmaz; uygulama kapanınca PIN tekrar istenir. */
export const shopfloorOperatorMemory = new Map<string, ShopfloorOperatorSession>();

function memoryKey(companyId: string, userId: string): string {
  return `${companyId}:${userId}`;
}

function asOperators(rows: unknown): ShopfloorOperatorRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ShopfloorOperatorRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as {
      operator_type?: unknown;
      id?: unknown;
      name?: unknown;
      station?: unknown;
      personnel_no?: unknown;
      employee_code?: unknown;
      code?: unknown;
    };
    const id = String(rec.id || "").trim();
    if (!id) continue;
    const stationName = String(rec.station || "").trim();
    const personnelNo = String(rec.personnel_no || "").trim();
    const employeeCode = String(rec.employee_code || "").trim();
    const code = String(rec.code || "").trim();
    out.push({
      operator_type: String(rec.operator_type || ""),
      id,
      name: String(rec.name || ""),
      ...(stationName ? { station: stationName } : {}),
      ...(personnelNo ? { personnel_no: personnelNo } : {}),
      ...(employeeCode ? { employee_code: employeeCode } : {}),
      ...(code ? { code } : {}),
    });
  }
  return out;
}

const SESSION_ENDED = "Operatör oturumu sona erdi, yeniden PIN girin.";

/** İstasyon grup sırası korunur; durum sırası her grubun içinde uygulanır. */
function arrangeOpenWorkOrders(list: WorkOrder[], grouped: boolean): WorkOrder[] {
  if (!grouped) return sortWorkOrdersByStatus(list);
  return shopFloorStationSections(groupWorkOrdersByStation(list)).flatMap((sec) => sortWorkOrdersByStatus(sec.items));
}

function stepSegmentCount(w: WorkOrder): number {
  const n = Number(w.step_count);
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.floor(n);
}

function useMinuteNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function WoCard({
  w,
  needsOperator,
  viewLocked,
  busy,
  baseUrl,
  pauseAllowed,
  pauseHint,
  stationLockMsg,
  undoLabel,
  onStart,
  onPause,
  onFinish,
  onPartial,
  onDrawing,
  onUndo,
  onTrash,
}: {
  w: WorkOrder;
  operator: string;
  needsOperator: boolean;
  viewLocked?: boolean;
  busy: boolean;
  baseUrl: string;
  pauseAllowed?: boolean;
  pauseHint?: string;
  stationLockMsg?: string;
  undoLabel?: string;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
  onPartial?: () => void;
  onDrawing?: () => void;
  onUndo?: () => void;
  onTrash?: () => void;
}) {
  const key = woCardKey(w);
  const border = shopFloorCardBorder(w.status);
  const borderWide = w.status === "in_progress" || w.status === "paused";
  const who = w.operator_name || w.assigned_name;
  const badgeWho = (w.status === "in_progress" || w.status === "paused") ? who : "";
  const imgs = (w.images || []).map((u) => resolveMediaUrl(baseUrl, u)).filter(Boolean).slice(0, 8);
  const operateLocked = !!viewLocked || needsOperator;
  const startLocked = operateLocked || !!stationLockMsg;
  const [detailOpen, setDetailOpen] = useState(false);
  const now = useMinuteNow(w.status === "paused" || w.status === "done");
  const pausedLabel = w.status === "paused" ? pausedForLabel(w.paused_at, now) : "";
  const segments = stepSegmentCount(w);
  const activeStep = Number(w.step_count) > 1 ? Math.floor(Number(w.step_no)) : 1;
  const hasDetail = (w.materials || []).length > 0 || !!w.notes;
  const title = cardTitle(w);
  const tags = cardTags(w);
  const projectTone = projectColor(w.project_id);
  const stationName = String(w.station || "").trim();
  const stationTone = stationName ? stationColor(stationName) : null;
  const plan = workOrderFinishPlan(w);
  const planLabel = workOrderQtyLabel(w, plan);
  const partialTotal = w.partial_qty_total;
  const showDrawing = w.status === "in_progress" || w.status === "ready" || w.status === "waiting" || w.status === "paused";
  const drawingWide = w.status === "ready" || w.status === "waiting" || w.status === "paused";
  return (
    <Card
      testID={`wo-card-${key}`}
      style={{ borderColor: border, borderWidth: borderWide ? 2 : 1, borderLeftWidth: 8, borderLeftColor: projectTone.stripe }}
    >
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Muted>{[w.order_code, w.step_no != null ? `Adım ${w.step_no}/${w.step_count || w.step_no}` : null].filter(Boolean).join(" • ")}</Muted>
          <Text
            testID={`wo-title-${key}`}
            style={{ fontWeight: "800", color: colors.text, fontSize: title.source === "recipe" ? 17 : 16 }}
            numberOfLines={2}
          >
            {title.text || "İş emri"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 3 }}>
            {stationTone ? (
              <Text
                testID={`wo-station-tag-${key}`}
                style={{ backgroundColor: stationTone.bg, color: stationTone.fg, fontSize: 11, fontWeight: "800", borderRadius: 6, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2 }}
              >
                {`■ ${stationName}`}
              </Text>
            ) : null}
            {title.product && title.product !== title.text ? (
              <Text numberOfLines={2} style={{ fontSize: 14, color: "#475569", flexShrink: 1 }}>{title.product}</Text>
            ) : null}
          </View>
          {tags.length ? (
            <View testID={`wo-tags-${key}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {tags.map((tag) => {
                const projectTag = tag.kind === "project";
                const customerTag = tag.kind === "customer";
                const prefix = projectTag ? "Proje " : (tag.kind === "order" ? "Sipariş " : "Müşteri: ");
                return (
                  <Text
                    key={tag.kind}
                    testID={`wo-tag-${tag.kind}-${key}`}
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      borderWidth: 1,
                      borderRadius: 6,
                      overflow: "hidden",
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      color: customerTag ? "#86198F" : projectTag ? projectTone.stripe : "#334155",
                      borderColor: customerTag ? "#F0ABFC" : projectTag ? projectTone.stripe : "#CBD5E1",
                      backgroundColor: customerTag ? "#FDF4FF" : projectTag ? "#fff" : "#F8FAFC",
                    }}
                  >
                    {prefix}{tag.label}
                  </Text>
                );
              })}
            </View>
          ) : null}
          <View testID={`wo-stepbar-${key}`} style={{ flexDirection: "row", gap: 3, marginTop: 4, marginBottom: 4 }}>
            {Array.from({ length: segments }, (_, i) => (
              <View
                key={i}
                style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i + 1 === activeStep ? "#F59E0B" : "#E2E8F0" }}
              />
            ))}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {w.trash_request_pending && w.status !== "done" ? (
            <View
              testID={`wo-trash-pending-${key}`}
              style={{ backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }}
            >
              <Text style={{ color: "#B45309", fontWeight: "800", fontSize: 10 }}>Silme onayı bekliyor</Text>
            </View>
          ) : onTrash && w.status !== "done" ? (
            <Pressable
              onPress={() => { if (!needsOperator) onTrash(); }}
              disabled={needsOperator}
              testID={`wo-trash-${key}`}
              hitSlop={8}
              style={{ padding: 4, opacity: needsOperator ? 0.4 : 1 }}
            >
              <Text style={{ color: "#E11D48", fontWeight: "800", fontSize: 12 }}>Sil</Text>
            </Pressable>
          ) : null}
          <Badge label={badgeWho ? `${woStatusTr(w.status)} · ${badgeWho}` : woStatusTr(w.status)} tone={woStatusTone(w.status)} />
        </View>
      </Row>
      <View
        testID={`wo-meta-${key}`}
        style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 2 }}
      >
        <Text style={{ fontSize: 12, color: colors.muted }}>
          İstasyon: <Text style={{ fontWeight: "700", color: colors.text }}>{w.station || "—"}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>
          İş dosyası: <Text style={{ fontWeight: "700", color: colors.text }}>{w.job_file_name || "—"}</Text>
        </Text>
        {planLabel ? (
          <Text testID={`wo-plan-${key}`} style={{ fontSize: 12, color: colors.muted }}>
            Plan: <Text style={{ fontWeight: "700", color: colors.text }}>{planLabel}</Text>
          </Text>
        ) : null}
        {String(w.step_note || "").trim() ? (
          <View testID={`wo-step-note-${key}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, width: "100%", maxWidth: "100%" }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Adım notu:</Text>
            <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 12, fontWeight: "700", color: "#92400E" }}>
              {String(w.step_note).trim()}
            </Text>
          </View>
        ) : null}
      </View>
      {imgs.length > 0 ? (
        <View testID={`wo-images-${key}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {imgs.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: "#E2E8F0" }} />
          ))}
        </View>
      ) : null}
      {pausedLabel ? (
        <Text testID={`wo-paused-for-${key}`} style={{ fontSize: 12, fontWeight: "700", color: "#9A3412" }}>
          {`⏸ ${pausedLabel} duraklatıldı · ${w.auto_paused ? "Otomatik (mesai dışı)" : "Elle"}`}
        </Text>
      ) : null}
      <Muted>
        {[
          (() => {
            const plan = workOrderFinishPlan(w);
            if (plan.isMaterial) {
              return `${formatQty(plan.qty)} ${plan.unit}${w.planned_quantity != null ? ` · mamul ${formatQty(w.planned_quantity)} ${w.unit || ""}` : ""}`.trim();
            }
            return w.planned_quantity != null ? `${formatQty(w.planned_quantity)} ${w.unit || ""}`.trim() : null;
          })(),
          w.duration_min ? `Hedef ${w.duration_min} dk` : null,
          w.elapsed_min != null ? (w.status === "paused" ? `çalışılan ${w.elapsed_min} dk` : `${w.elapsed_min} dk geçti`) : null,
          who,
          w.planned_date ? `Plan: ${fmtDate(w.planned_date)}` : null,
        ].filter(Boolean).join(" · ")}
      </Muted>
      {hasDetail ? (
        <Pressable
          testID={`wo-detail-toggle-${key}`}
          onPress={() => setDetailOpen((v) => !v)}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ fontWeight: "800", color: colors.primary }}>Detay</Text>
        </Pressable>
      ) : null}
      {detailOpen && hasDetail ? (
        <View style={{ gap: 6 }}>
          {(w.materials || []).length > 0 ? (
            <View
              testID={`wo-materials-${key}`}
              style={{ borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 4 }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>Hammaddeler</Text>
              {(w.materials || []).map((m, i) => {
                const stockNote = String(m.stock_note || m.note || "").trim();
                const pname = String(m.product_name || "").trim();
                const noteIsExtra = !!(
                  stockNote
                  && stockNote.toLocaleLowerCase("tr") !== pname.toLocaleLowerCase("tr")
                );
                return (
                <View key={m.product_id || String(i)} style={{ gap: 2 }} testID={`wo-mat-row-${key}-${i}`}>
                  <Row style={{ justifyContent: "space-between", gap: 8 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{ fontSize: 12, fontWeight: stockNote ? "700" : "400", color: stockNote ? colors.text : colors.muted }}
                        numberOfLines={3}
                        testID={stockNote ? `wo-mat-note-${key}-${i}` : undefined}
                      >
                        {stockNote || pname || "Hammadde"}
                      </Text>
                      {noteIsExtra && pname ? (
                        <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{pname}</Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>
                      {formatQty(roundNeededQty(Number(m.needed), m.unit))} {m.unit || ""}
                    </Text>
                  </Row>
                </View>
                );
              })}
            </View>
          ) : null}
          {w.notes ? <Muted>{w.notes}</Muted> : null}
        </View>
      ) : null}
      {w.status === "in_progress" && partialTotal != null ? (
        <View testID={`wo-partial-bar-${key}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: "#475569" }}>Ara sayım toplamı</Text>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{formatQty(partialTotal)} / {formatQty(plan.qty)} {plan.unit}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 99, backgroundColor: "#E2E8F0", overflow: "hidden" }}>
            <View style={{ height: 8, backgroundColor: "#F59E0B", width: `${Math.min(100, Math.round((Number(partialTotal) / Math.max(Number(plan.qty) || 1, 1)) * 100))}%` }} />
          </View>
        </View>
      ) : null}
      {w.status === "ready" || w.status === "waiting" ? (
        <>
          <PrimaryButton title="Başla" onPress={() => { if (!startLocked) onStart(); }} disabled={busy || startLocked} loading={busy} color={colors.primary} testID={`wo-start-${key}`} />
          {stationLockMsg ? <Muted>{stationLockMsg}</Muted> : null}
          {w.status === "waiting" && !stationLockMsg ? <Muted>Önceki adım bitmeden de başlatılabilir</Muted> : null}
        </>
      ) : null}
      {w.status === "in_progress" || w.status === "paused" ? (
        <Row>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              title={w.status === "paused" ? "Devam" : "Duraklat"}
              onPress={() => {
                if (w.status === "paused") {
                  if (!startLocked) onStart();
                  return;
                }
                if (!operateLocked && pauseAllowed !== false) onPause();
              }}
              disabled={
                operateLocked
                || busy
                || (w.status === "paused" && !!stationLockMsg)
                || (w.status === "in_progress" && pauseAllowed === false)
              }
              loading={busy}
              color={w.status === "paused" ? colors.primary : "#EA580C"}
              testID={w.status === "paused" ? `wo-resume-${key}` : `wo-pause-${key}`}
            />
            {w.status === "paused" && stationLockMsg ? <Muted>{stationLockMsg}</Muted> : null}
            {w.status === "in_progress" && !operateLocked && pauseAllowed === false && pauseHint ? (
              <Muted>{pauseHint}</Muted>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton title="Bitir" onPress={() => { if (!operateLocked) onFinish(); }} disabled={operateLocked || busy} color={colors.secondary} testID={`wo-finish-${key}`} />
          </View>
        </Row>
      ) : null}
      {w.status === "in_progress" ? (
        <Pressable
          testID={`wo-partial-${key}`}
          disabled={operateLocked}
          onPress={() => { if (!operateLocked) onPartial?.(); }}
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 2, borderColor: operateLocked ? "#E2E8F0" : "#CBD5E1", backgroundColor: operateLocked ? "#E2E8F0" : "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}
        >
          <Text style={{ fontWeight: "700", fontSize: 15, color: operateLocked ? "#94A3B8" : colors.text }}>
            Ara sayım{partialTotal != null ? ` ${formatQty(partialTotal)}/${formatQty(plan.qty)}` : ""}
          </Text>
        </Pressable>
      ) : null}
      {showDrawing ? (
        <Pressable
          testID={`wo-drawing-${key}`}
          onPress={() => onDrawing?.()}
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 2, borderColor: "#BFDBFE", backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", alignSelf: drawingWide ? "stretch" : "auto" }}
        >
          <Text style={{ fontWeight: "700", color: "#1D4ED8", fontSize: drawingWide ? 13 : 15 }}>Teknik çizim</Text>
        </Pressable>
      ) : null}
      {w.status === "done" ? (
        <Text testID={`wo-done-summary-${key}`} style={{ textAlign: "center", fontSize: 12, fontWeight: "600", color: "#047857" }}>
          {w.produced_qty != null ? `${w.produced_qty} üretildi` : "Tamamlandı"}
          {w.scrap_qty ? `, ${w.scrap_qty} fire${w.scrap_reason_label ? ` (${w.scrap_reason_label})` : ""}` : ""}
          {w.operator_name ? ` • ${w.operator_name}` : ""}
        </Text>
      ) : null}
      {w.status === "done" && undoLabel ? (
        <Pressable
          testID={`wo-undo-${key}`}
          disabled={operateLocked}
          onPress={() => { if (!operateLocked) onUndo?.(); }}
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 2, borderColor: operateLocked ? "#E2E8F0" : "#F59E0B", alignItems: "center", justifyContent: "center", opacity: operateLocked ? 0.5 : 1 }}
        >
          <Text style={{ fontWeight: "800", color: operateLocked ? "#94A3B8" : "#B45309" }}>{`Geri al (${undoLabel})`}</Text>
        </Pressable>
      ) : null}
      {needsOperator ? (
        <Text testID={`wo-need-operator-${key}`} style={{ fontSize: 11, fontWeight: "700", color: "#B45309", textAlign: "center" }}>Önce operatör seçin</Text>
      ) : null}
    </Card>
  );
}

export function AtolyeScreen() {
  const { client, companyId, user, baseUrl, can } = useAuth();
  const canView = can("/atolye");
  const mayOperate = user ? shopfloorMayOperate(user) : can("/atolye", "edit");
  const atolye = isAtolyeAccount(user);
  const userId = String(user?.id || "");
  const [wos, setWos] = useState<WorkOrder[]>([]);
  /** İstasyon filtresinden bağımsız in_progress — operatör kilit UI */
  const [lockWos, setLockWos] = useState<WorkOrder[]>([]);
  const [operators, setOperators] = useState<ShopfloorOperatorRow[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [operator, setOperator] = useState("");
  const [operatorSession, setOperatorSession] = useState<ShopfloorOperatorSession | null>(null);
  const [linkedName, setLinkedName] = useState("");
  const [station, setStation] = useState("");
  const [pendingOp, setPendingOp] = useState<ShopfloorOperatorRow | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const operatorSessionRef = useRef<ShopfloorOperatorSession | null>(null);
  const atolyeRef = useRef(atolye);
  const endOperatorSessionRef = useRef<() => void>(() => {});
  operatorSessionRef.current = operatorSession;
  atolyeRef.current = atolye;
  const [finishing, setFinishing] = useState<WorkOrder | null>(null);
  const [fin, setFin] = useState<{ produced_qty: string | number; scrap_qty: string | number; notes: string }>({ produced_qty: "", scrap_qty: "0", notes: "" });
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashTarget, setTrashTarget] = useState<WorkOrder | null>(null);
  const [trashReqBusy, setTrashReqBusy] = useState(false);
  const [trashReqErr, setTrashReqErr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duties, setDuties] = useState<AssignedDuty[]>([]);
  const [dutyBusyId, setDutyBusyId] = useState<string | null>(null);
  const [showArchivedDuties, setShowArchivedDuties] = useState(false);
  const [groupSameStation, setGroupSameStation] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [kpi, setKpi] = useState<ShopFloorKpiFilter | null>(null);
  const [pausePolicy, setPausePolicy] = useState<PausePolicy>({ allowed: true, phase: "mesai" });
  const [projectId, setProjectId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [filterCatalog, setFilterCatalog] = useState<{ projects: Record<string, unknown>[]; recipes: Record<string, unknown>[] }>({ projects: [], recipes: [] });
  const [filterMenu, setFilterMenu] = useState<"" | "project" | "recipe">("");
  const [shopSettings, setShopSettings] = useState<{ idle_lock_minutes: number; undo_finish_minutes: number; scrap_reasons: ScrapReason[] }>({
    idle_lock_minutes: 30,
    undo_finish_minutes: 5,
    scrap_reasons: [],
  });
  const [partialJob, setPartialJob] = useState<WorkOrder | null>(null);
  const [partialBusy, setPartialBusy] = useState(false);
  const [takeover, setTakeover] = useState<{ w: WorkOrder; action: "start" | "pause" | "finish"; body?: Record<string, unknown>; detail: TakeoverDetail } | null>(null);
  const [drawing, setDrawing] = useState<{ title: string; filename?: string; expiresIn?: number; url?: string; contentType?: string } | null>(null);
  const [undoToast, setUndoToast] = useState<{ text: string; finishedAt: string; workOrder: WorkOrder } | null>(null);
  const [idleLocked, setIdleLocked] = useState(false);
  const [idleErr, setIdleErr] = useState("");
  const [idleBusy, setIdleBusy] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [scrapReason, setScrapReason] = useState<ScrapReason | null>(null);
  const [nowTick, setNowTick] = useState(() => new Date());

  const loadPausePolicy = useCallback(async (opName: string) => {
    if (!opName) {
      if (!atolye) {
        setPausePolicy({ allowed: true, phase: "mesai" });
        return;
      }
      setPausePolicy({ allowed: false, phase: "outside", reason: "Önce operatör seçin." });
      return;
    }
    try {
      const r = await get<PausePolicy>(client, "/production/work-orders/pause-policy", {
        company_id: companyId,
        operator_name: opName,
      });
      setPausePolicy(r || { allowed: false, phase: "outside" });
    } catch {
      setPausePolicy({ allowed: true, phase: "mesai" });
    }
  }, [atolye, client, companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setRefreshing(true);
    try {
      const [w, lockRows, ops, s, parks, me, settings, filters] = await Promise.all([
        get<WorkOrder[]>(client, "/production/work-orders", {
          company_id: companyId,
          station: station || undefined,
          project_id: projectId || undefined,
          recipe_id: recipeId || undefined,
        }),
        station
          ? get<WorkOrder[]>(client, "/production/work-orders", {
              company_id: companyId,
              status: "in_progress",
            }).catch(() => [])
          : Promise.resolve(null),
        atolye
          ? get<unknown>(client, "/production/work-orders/shopfloor-operators", { company_id: companyId }).catch(() => [])
          : Promise.resolve([]),
        get<string[]>(client, "/production/work-orders/stations", { company_id: companyId }).catch(() => []),
        get<{ parks?: unknown[] }>(client, `/companies/${companyId}/work-parks`).catch(() => ({ parks: [] })),
        get<{ employee?: { full_name?: string }; tasks?: AssignedDuty[] }>(client, "/personnel/me").catch(() => null),
        get<{ group_same_station?: boolean; idle_lock_minutes?: number; undo_finish_minutes?: number; scrap_reasons?: ScrapReason[] }>(
          client,
          "/production/work-orders/shopfloor-settings",
          { company_id: companyId },
        ).catch(() => null),
        get<unknown>(client, "/production/work-orders/shopfloor-filters", {
          company_id: companyId,
          station: station || undefined,
        }).catch(() => ({ projects: [], recipes: [] })),
      ]);
      const list = Array.isArray(w) ? w : [];
      setWos(list);
      setLockWos(station ? (Array.isArray(lockRows) ? lockRows : []) : list);
      setOperators(atolye ? asOperators(ops) : []);
      setStations(stationNamesFromParks(parks?.parks, Array.isArray(s) ? s : []));
      setDuties(Array.isArray(me?.tasks) ? me.tasks : []);
      setLinkedName(String(me?.employee?.full_name || "").trim());
      setFilterCatalog(normalizeShopfloorFilters(filters));
      if (settings && typeof settings.group_same_station === "boolean") setGroupSameStation(settings.group_same_station);
      if (settings) {
        setShopSettings((prev) => ({
          ...prev,
          idle_lock_minutes: Number(settings.idle_lock_minutes) || prev.idle_lock_minutes,
          undo_finish_minutes: Number(settings.undo_finish_minutes) || prev.undo_finish_minutes,
          scrap_reasons: normalizeScrapReasons(settings.scrap_reasons),
        }));
      }
      setError(null);
    } catch {
      setError("Yetkiniz yok / yüklenemedi");
    } finally {
      setRefreshing(false);
    }
  }, [atolye, canView, client, companyId, projectId, recipeId, station]);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 5000);
      const sub = AppState.addEventListener("change", (state) => {
        if (state !== "active") return;
        load();
        const current = operatorSessionRef.current;
        if (atolyeRef.current && current && isSessionExpired(current, new Date())) {
          endOperatorSessionRef.current();
        }
      });
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [load])
  );
  useFocusEffect(
    useCallback(() => {
      loadPausePolicy(operator);
      const t = setInterval(() => loadPausePolicy(operator), 60000);
      return () => clearInterval(t);
    }, [loadPausePolicy, operator])
  );
  useEffect(() => {
    if (!undoToast) return undefined;
    const t = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(t);
  }, [undoToast]);
  useEffect(() => {
    if (!atolye || !operatorSession || idleLocked) return undefined;
    const minutes = Number(shopSettings.idle_lock_minutes) || 30;
    const timer = setTimeout(() => setIdleLocked(true), minutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [atolye, idleLocked, operatorSession, shopSettings.idle_lock_minutes]);

  const ownName = (linkedName || String(user?.name || "")).trim();

  useEffect(() => {
    if (atolye) return;
    setOperator(ownName);
    setOperatorSession(null);
    setPendingOp(null);
    setUnlockErr("");
  }, [atolye, ownName]);

  useEffect(() => {
    if (!atolye) return;
    const key = memoryKey(companyId, userId);
    const saved = userId ? shopfloorOperatorMemory.get(key) : undefined;
    if (!saved || isSessionExpired(saved, new Date())) {
      if (saved) {
        shopfloorOperatorMemory.delete(key);
        setOperatorSession(null);
        setOperator("");
        setPendingOp(null);
        setUnlockErr("");
        setSessionNote(SESSION_ENDED);
      }
      return;
    }
    setOperatorSession(saved);
    setOperator(saved.operator_name || "");
  }, [atolye, companyId, userId]);

  useEffect(() => {
    if (!atolye || !operatorSession) return;
    if (!isSessionExpired(operatorSession, new Date())) return;
    endOperatorSessionRef.current();
  }, [atolye, operatorSession]);

  const endOperatorSession = () => {
    if (companyId && userId) shopfloorOperatorMemory.delete(memoryKey(companyId, userId));
    setOperatorSession(null);
    setOperator("");
    setPendingOp(null);
    setUnlockErr("");
    setSessionNote(SESSION_ENDED);
  };
  endOperatorSessionRef.current = endOperatorSession;

  const logoutOperator = () => {
    if (atolye && companyId && userId) shopfloorOperatorMemory.delete(memoryKey(companyId, userId));
    setOperatorSession(null);
    setOperator(atolye ? "" : ownName);
    setPendingOp(null);
    setUnlockErr("");
    setSessionNote(null);
  };

  const cancelUnlock = () => {
    setPendingOp(null);
    setUnlockErr("");
  };

  const chooseOperator = (op: ShopfloorOperatorRow) => {
    setPendingOp(op);
    setUnlockErr("");
    setSessionNote(null);
  };

  const submitPin = async (pin: string) => {
    if (!atolye || !pendingOp || unlockBusy) return;
    if (!isValidPin(pin)) {
      setUnlockErr("PIN 4 haneli olmalı.");
      return;
    }
    setUnlockBusy(true);
    setUnlockErr("");
    try {
      const r = await post<{
        operator_token?: string;
        operator_name?: string;
        operator_type?: string;
        operator_id?: string;
        expires_at?: string;
      }>(client, "/production/work-orders/shopfloor-unlock", {
        company_id: companyId,
        operator_type: pendingOp.operator_type,
        operator_id: pendingOp.id,
        pin,
      });
      const session: ShopfloorOperatorSession = {
        token: String(r.operator_token || ""),
        operator_name: String(r.operator_name || pendingOp.name || ""),
        operator_type: String(r.operator_type || pendingOp.operator_type || ""),
        operator_id: String(r.operator_id || pendingOp.id),
        expires_at: String(r.expires_at || ""),
      };
      if (!session.token || isSessionExpired(session, new Date())) {
        setPendingOp(null);
        setOperatorSession(null);
        setOperator("");
        setSessionNote(SESSION_ENDED);
        return;
      }
      shopfloorOperatorMemory.set(memoryKey(companyId, userId), session);
      setOperatorSession(session);
      setOperator(session.operator_name);
      setPendingOp(null);
      setNotice(`${session.operator_name} olarak giriş yapıldı.`);
      setError(null);
      setSessionNote(null);
      await loadPausePolicy(session.operator_name);
    } catch (err) {
      setUnlockErr(unlockErrorMessage(err));
    } finally {
      setUnlockBusy(false);
    }
  };

  const postHeaders = (extra?: Record<string, string>) => {
    const headers = { ...(extra || {}), ...(atolye ? operatorHeaders(operatorSession) : {}) };
    return Object.keys(headers).length ? headers : undefined;
  };

  const act = async (w: WorkOrder, action: "start" | "pause" | "finish", body?: Record<string, unknown>) => {
    if (!mayOperate) {
      setError("Görüntüleme yetkisiyle iş başlatılamaz.");
      return;
    }
    if (atolye && !operator) {
      setError("Önce operatör (personel) seçin.");
      return;
    }
    if (atolye && isSessionExpired(operatorSession, new Date())) {
      endOperatorSession();
      return;
    }
    const wid = idOf(w);
    if (!wid) {
      setError("İş emri kimliği bulunamadı.");
      return;
    }
    if (action === "start") {
      const blocker = operatorStationLock(lockWos, operator, w.station, wid);
      if (blocker) {
        setError(operatorStationLockMessage(blocker, operator));
        return;
      }
    }
    const key = woCardKey(w);
    setBusyId(key);
    try {
      const payload = { operator_name: operator, ...(body || {}) };
      const headers = postHeaders();
      const r = headers
        ? await post<{ message?: string; work_order?: WorkOrder }>(
          client,
          `/production/work-orders/${wid}/${action}`,
          payload,
          undefined,
          headers,
        )
        : await post<{ message?: string; work_order?: WorkOrder }>(
          client,
          `/production/work-orders/${wid}/${action}`,
          payload,
        );
      setNotice(r.message || "İşlem tamamlandı.");
      setError(null);
      setFinishing(null);
      setTakeover(null);
      setScrapReason(null);
      if (action === "finish") {
        const finishedAt = r.work_order?.finished_at || new Date().toISOString();
        setUndoToast({
          text: `${w.order_code || "İş"} Adım ${w.step_no ?? ""} bitirildi · stok işlendi`.trim(),
          finishedAt,
          workOrder: r.work_order || { ...w, status: "done", finished_at: finishedAt },
        });
      }
      // Web tablete hemen yansısın diye yerel durumu anında güncelle
      if (r.work_order && idOf(r.work_order)) {
        const uid = idOf(r.work_order);
        const updated = r.work_order;
        setWos((prev) => {
          const hit = prev.some((x) => idOf(x) === uid);
          if (hit) return prev.map((x) => (idOf(x) === uid ? { ...x, ...updated } : x));
          return prev;
        });
        setLockWos((prev) => {
          if (String(updated.status || "") === "in_progress") {
            const hit = prev.some((x) => idOf(x) === uid);
            if (hit) return prev.map((x) => (idOf(x) === uid ? { ...x, ...updated } : x));
            return [...prev, updated];
          }
          return prev.filter((x) => idOf(x) !== uid);
        });
      } else if (action === "finish") {
        setWos((prev) => prev.map((x) => (idOf(x) === wid ? { ...x, status: "done" } : x)));
        setLockWos((prev) => prev.filter((x) => idOf(x) !== wid));
      }
      await load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) {
        endOperatorSession();
        return;
      }
      const takeoverInfo = takeoverDetail(err);
      if (takeoverInfo) {
        setTakeover({ w, action, body: body || {}, detail: takeoverInfo });
        return;
      }
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const openFinish = (w: WorkOrder) => {
    if (!mayOperate) return;
    const plan = workOrderFinishPlan(w);
    setFinishing(w);
    setScrapReason(null);
    setFin({ produced_qty: String(plan.qty ?? 0), scrap_qty: "0", notes: "" });
  };

  const openDrawing = async (w: WorkOrder) => {
    const wid = idOf(w);
    if (!wid) return;
    try {
      const headers = postHeaders();
      const data = await get<{ url?: string; content_type?: string; filename?: string; expires_in?: number }>(
        client,
        `/production/work-orders/${wid}/drawing`,
        undefined,
        headers,
      );
      setDrawing({
        title: `${w.order_code || ""} Adım ${w.step_no ?? ""}/${w.step_count ?? ""}`.trim(),
        filename: data?.filename,
        expiresIn: data?.expires_in,
        url: resolveMediaUrl(baseUrl, data?.url),
        contentType: data?.content_type,
      });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Teknik çizim açılamadı."));
    }
  };

  const submitPartial = async (qty: number) => {
    if (!mayOperate || !partialJob || partialBusy) return;
    const wid = idOf(partialJob);
    if (!wid) return;
    setPartialBusy(true);
    try {
      const headers = postHeaders({ "Idempotency-Key": idempotencyKey() });
      const r = await post<{ partial_qty_total?: number; message?: string }>(
        client,
        `/production/work-orders/${wid}/partial-count`,
        { qty, operator_name: operator },
        undefined,
        headers,
      );
      if (r.partial_qty_total != null) {
        setWos((prev) => prev.map((row) => (idOf(row) === wid ? { ...row, partial_qty_total: r.partial_qty_total } : row)));
      }
      setPartialJob(null);
      setNotice("Ara sayım eklendi.");
      setError(null);
      await load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) {
        endOperatorSession();
        return;
      }
      setError(apiErrorMessage(err, "Ara sayım eklenemedi."));
    } finally {
      setPartialBusy(false);
    }
  };

  const undoWork = async (w: WorkOrder) => {
    if (!mayOperate || !w) return;
    const wid = idOf(w);
    if (!wid) return;
    try {
      const headers = postHeaders();
      const r = await post<{ message?: string }>(
        client,
        `/production/work-orders/${wid}/undo-finish`,
        { operator_name: operator },
        undefined,
        headers,
      );
      setNotice(r.message || "Bitirme geri alındı.");
      setUndoToast(null);
      setError(null);
      await load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) {
        endOperatorSession();
        return;
      }
      setError(apiErrorMessage(err, "Geri alınamadı."));
    }
  };

  const submitIdlePin = async (pin: string) => {
    if (!operatorSession || idleBusy) return;
    if (!isValidPin(pin)) {
      setIdleErr("PIN 4 haneli olmalı.");
      return;
    }
    setIdleBusy(true);
    setIdleErr("");
    try {
      const r = await post<{
        operator_token?: string;
        operator_name?: string;
        operator_type?: string;
        operator_id?: string;
        expires_at?: string;
      }>(client, "/production/work-orders/shopfloor-unlock", {
        company_id: companyId,
        operator_type: operatorSession.operator_type,
        operator_id: operatorSession.operator_id,
        pin,
      });
      const session: ShopfloorOperatorSession = {
        token: String(r.operator_token || operatorSession.token),
        operator_name: String(r.operator_name || operatorSession.operator_name),
        operator_type: String(r.operator_type || operatorSession.operator_type),
        operator_id: String(r.operator_id || operatorSession.operator_id),
        expires_at: String(r.expires_at || operatorSession.expires_at),
      };
      shopfloorOperatorMemory.set(memoryKey(companyId, userId), session);
      setOperatorSession(session);
      setOperator(session.operator_name);
      setIdleLocked(false);
      setIdleErr("");
    } catch (err) {
      setIdleErr(unlockErrorMessage(err));
    } finally {
      setIdleBusy(false);
    }
  };

  const confirmFinish = () => {
    if (!finishing) return;
    const produced = Number(fin.produced_qty);
    const scrap = Number(fin.scrap_qty);
    const plan = workOrderFinishPlan(finishing);
    // Web ile aynı: plan üstü serbest; yalnızca negatif miktar engellenir.
    const qtyErr = finishQtyError(produced, scrap, plan.qty);
    if (qtyErr) {
      setError(qtyErr);
      return;
    }
    act(finishing, "finish", {
      produced_qty: produced,
      scrap_qty: scrap,
      notes: fin.notes,
      ...(scrapReason ? { scrap_reason_code: scrapReason.code, scrap_reason_label: scrapReason.label } : {}),
    });
  };

  const shownWos = useMemo(
    () => wos.filter((w) => matchesLinkFilter(w, projectId, recipeId)),
    [projectId, recipeId, wos],
  );
  const parts = useMemo(() => partitionWorkOrders(shownWos, operator), [operator, shownWos]);
  const visible = useMemo(() => {
    if (kpi === "done") {
      const todayDone = filterByKpi(shownWos, "done");
      return {
        mine: todayDone.filter((w) => isMine(w, operator)),
        others: todayDone.filter((w) => !isMine(w, operator)),
        waiting: [] as WorkOrder[],
      };
    }
    return {
      mine: filterByKpi(parts.mine, kpi),
      others: filterByKpi(parts.others, kpi),
      waiting: filterByKpi(parts.waiting, kpi),
    };
  }, [kpi, operator, parts.mine, parts.others, parts.waiting, shownWos]);
  const arrangedMine = useMemo(
    () => arrangeOpenWorkOrders(visible.mine, groupSameStation),
    [groupSameStation, visible.mine],
  );
  const arrangedOthers = useMemo(
    () => arrangeOpenWorkOrders(visible.others, groupSameStation),
    [groupSameStation, visible.others],
  );
  const arrangedWaiting = useMemo(
    () => (groupSameStation ? groupWorkOrdersByStation(visible.waiting) : visible.waiting),
    [groupSameStation, visible.waiting],
  );

  const toggleGroupSameStation = async (on: boolean) => {
    setGroupSameStation(on);
    setGroupBusy(true);
    try {
      const r = await post<{ message?: string }>(client, "/production/work-orders/shopfloor-settings", {
        company_id: companyId,
        group_same_station: on,
      });
      setNotice(r.message || (on ? "Peşi sıra istasyon sıralaması açıldı." : "Peşi sıra istasyon sıralaması kapatıldı."));
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Sıralama kaydedilemedi."));
    } finally {
      setGroupBusy(false);
    }
  };

  const renderGrouped = (items: WorkOrder[], renderCard: (w: WorkOrder) => React.ReactNode) => {
    const sections = groupSameStation
      ? shopFloorStationSections(items)
      : [{ key: "all", label: "", items }];
    return sections.map((sec) => (
      <View key={sec.key} testID={groupSameStation ? `shopfloor-station-group-${sec.key}` : undefined}>
        {groupSameStation ? (
          <Text style={{ fontWeight: "800", color: colors.muted, marginTop: 6 }}>
            {sec.label} ({sec.items.length})
          </Text>
        ) : null}
        {sec.items.map((w) => renderCard(w))}
      </View>
    ));
  };
  const stationGroups = useMemo(
    () => [{ label: "İstasyon", options: stations.map((s) => ({ value: s, label: s })) }],
    [stations],
  );

  const trashCompleted = () => {
    const n = parts.done.length;
    if (!n || trashBusy) return;
    Alert.alert(
      "Çöpe taşı",
      `${n} tamamlanan iş emri çöp kutusuna taşınsın mı? 30 gün içinde geri getirilebilir.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Çöpe taşı",
          style: "destructive",
          onPress: async () => {
            setTrashBusy(true);
            try {
              const r = await post<{ message?: string; count?: number }>(client, "/production/work-orders/trash-completed", {
                company_id: companyId,
                ...(station ? { station } : {}),
              });
              setNotice(r.message || "Tamamlananlar çöpe taşındı.");
              setError(null);
              await load();
            } catch (err) {
              setError(apiErrorMessage(err, "Çöpe taşınamadı."));
            } finally {
              setTrashBusy(false);
            }
          },
        },
      ],
    );
  };

  const finishLast = finishing && finishing.step_no === finishing.step_count && (finishing.step_count || 0) > 0;
  const openDuties = useMemo(() => openAssignedDuties(duties), [duties]);
  const archivedDuties = useMemo(() => archivedAssignedDuties(duties), [duties]);
  const visibleDuties = showArchivedDuties ? archivedDuties : openDuties;

  const approveDuty = async (t: AssignedDuty) => {
    if (!t.id) {
      setError("Görev numarası yok.");
      return;
    }
    setDutyBusyId(t.id);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/me/tasks/${t.id}/complete`, {});
      setNotice(r.message || "Görev tamamlandı.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Görev onaylanamadı."));
    } finally {
      setDutyBusyId(null);
    }
  };

  const openTrashRequest = (w: WorkOrder) => {
    if (w.status === "done") {
      setError("Tamamlanan adım buradan silinmez; alttaki çöpe taşıyı kullanın.");
      return;
    }
    if ((w as WorkOrder & { trash_request_pending?: boolean }).trash_request_pending) {
      setNotice("Bu iş emri için silme talebi zaten yönetici onayında.");
      return;
    }
    if (atolye && !operator) {
      setError("Önce operatör seçin.");
      return;
    }
    setTrashTarget(w);
    setTrashReqErr("");
  };
  const cancelTrashRequest = () => {
    setTrashTarget(null);
    setTrashReqErr("");
  };
  const confirmTrashRequest = async () => {
    const wid = idOf(trashTarget);
    if (!wid || trashReqBusy) return;
    if (atolye && isSessionExpired(operatorSession, new Date())) {
      endOperatorSession();
      cancelTrashRequest();
      return;
    }
    setTrashReqBusy(true);
    setTrashReqErr("");
    try {
      const payload = { company_id: companyId, operator_name: operator };
      const r = atolye
        ? await post<{ message?: string }>(
          client,
          `/production/work-orders/${wid}/trash-request`,
          payload,
          undefined,
          operatorHeaders(operatorSession),
        )
        : await post<{ message?: string }>(client, `/production/work-orders/${wid}/trash-request`, payload);
      setNotice(r.message || "Silme talebi yöneticiye gönderildi.");
      setError(null);
      cancelTrashRequest();
      await load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) {
        endOperatorSession();
        cancelTrashRequest();
        return;
      }
      setTrashReqErr(apiErrorMessage(err, "Talep gönderilemedi."));
    } finally {
      setTrashReqBusy(false);
    }
  };

  const needsOperator = atolye && !operator;
  const renderWo = (w: WorkOrder) => (
    <WoCard
      key={woCardKey(w)}
      w={w}
      operator={operator}
      needsOperator={needsOperator}
      viewLocked={!mayOperate}
      busy={busyId === woCardKey(w)}
      baseUrl={baseUrl}
      pauseAllowed={!!pausePolicy?.allowed}
      pauseHint={pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz"}
      stationLockMsg={operatorStationLockMessage(operatorStationLock(lockWos, operator, w.station, idOf(w)), operator)}
      undoLabel={w.status === "done" ? undoCountdown(w.finished_at, shopSettings.undo_finish_minutes, nowTick) || "" : ""}
      onStart={() => act(w, "start")}
      onPause={() => act(w, "pause")}
      onFinish={() => openFinish(w)}
      onPartial={() => setPartialJob(w)}
      onDrawing={() => { void openDrawing(w); }}
      onUndo={() => { void undoWork(w); }}
      onTrash={() => openTrashRequest(w)}
    />
  );

  const pickedFocus = focusOpen ? focusJob(shownWos, operator) : null;
  const focusPlan = pickedFocus?.job ? workOrderFinishPlan(pickedFocus.job) : null;
  const operatorCode = personnelCode(operators.find((row) => row.id === operatorSession?.operator_id));
  const undoLeft = undoToast ? undoCountdown(undoToast.finishedAt, shopSettings.undo_finish_minutes, nowTick) : null;

  if (!canView) {
    return (
      <Screen>
        <ErrorBanner message="Atölye yetkiniz yok." />
      </Screen>
    );
  }

  const stationBadges = Array.isArray(user?.shopfloor_stations) ? user.shopfloor_stations.filter(Boolean) : [];
  const kpiItems: { key: ShopFloorKpiFilter; testID: string; label: string; value: string; valueColor: string }[] = [
    { key: "ready", testID: "shopfloor-kpi-ready", label: "Hazır", value: String(readyCount(shownWos)), valueColor: "#2563EB" },
    { key: "active", testID: "shopfloor-kpi-active", label: "Devam Eden", value: String(runningCount(shownWos)), valueColor: "#D97706" },
    { key: "done", testID: "shopfloor-kpi-done", label: "Bugün Biten", value: String(todayDoneCount(shownWos)), valueColor: colors.primaryHover },
  ];

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {atolye ? (
        <View
          testID="shopfloor-atolye-banner"
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Text testID="shopfloor-atolye-account" style={{ fontWeight: "800", color: colors.text }}>
            {user?.name || "Atölye"} · Atölye kullanıcısı
          </Text>
          {stationBadges.map((name) => {
            const tone = stationColor(name);
            return (
              <View key={name} testID={`shopfloor-station-badge-${name}`} style={{ backgroundColor: tone.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: tone.fg }}>{`■ ${name}`}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {atolye && !operator ? (
        <Card
          testID="shopfloor-no-operator"
          style={{ backgroundColor: colors.amber50, borderColor: "#F59E0B", borderWidth: 2, paddingVertical: 18, paddingHorizontal: 14, gap: 8 }}
        >
          <Text style={{ fontWeight: "800", color: colors.text, fontSize: 28 }}>Kim çalışıyor?</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Adınıza dokunun, sonra şifrenizi girin.</Text>
          <Text style={{ fontWeight: "800", color: "#92400E", fontSize: 16 }}>Operatör seçin</Text>
          <Text style={{ fontWeight: "600", color: "#B45309", fontSize: 14 }}>Başla / Devam / Bitir operatör PIN girişinden sonra açılır.</Text>
          {operators.length === 0 ? (
            <Text testID="shopfloor-operators-empty" style={{ fontWeight: "700", color: "#92400E" }}>
              PIN tanımlı ve mesaiye giriş yapmış operatör yok
            </Text>
          ) : (
            <View testID="shopfloor-operators" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {operators.map((op) => (
                <Pressable
                  key={`${op.operator_type || "op"}-${op.id}`}
                  testID={`shopfloor-operator-card-${op.id}`}
                  onPress={() => chooseOperator(op)}
                  style={{ width: "47%", minHeight: 120, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2, borderColor: "#E2E8F0", paddingHorizontal: 12, paddingVertical: 12, gap: 4, alignItems: "center" }}
                >
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 22, fontWeight: "800", color: "#1D4ED8" }}>{shopfloorInitials(op.name)}</Text>
                  </View>
                  <Text style={{ fontWeight: "800", color: colors.text, textAlign: "center" }}>{op.name}</Text>
                  {op.station ? <Text style={{ fontSize: 12, color: colors.muted }}>{op.station}</Text> : null}
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primaryHover }}>PIN tanımlı</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={{ color: colors.muted, fontSize: 15 }}>Birkaç dakika işlem yapılmazsa ekran kilitlenir</Text>
        </Card>
      ) : (
        <View
          testID="shopfloor-operator-chip"
          style={{ alignSelf: "flex-start", backgroundColor: colors.emerald50, borderWidth: 1, borderColor: "#A7F3D0", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          {atolye ? (
            <Row style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Text style={{ fontWeight: "800", color: colors.primaryHover }}>
                {`Operatör: ${operator}${personnelCode(operators.find((row) => row.id === operatorSession?.operator_id)) ? ` · ${personnelCode(operators.find((row) => row.id === operatorSession?.operator_id))}` : ""}`}
              </Text>
              <Text style={{ color: colors.primaryHover }}>·</Text>
              <Pressable onPress={logoutOperator} hitSlop={8} testID="shopfloor-operator-change" style={{ minHeight: 44, justifyContent: "center" }}>
                <Text style={{ color: colors.primaryHover, fontWeight: "800", textDecorationLine: "underline" }}>değiştir</Text>
              </Pressable>
              <Text style={{ color: colors.primaryHover }}>·</Text>
              <Pressable onPress={logoutOperator} hitSlop={8} testID="shopfloor-operator-logout" style={{ minHeight: 44, justifyContent: "center" }}>
                <Text style={{ color: colors.primaryHover, fontWeight: "800", textDecorationLine: "underline" }}>Çıkış</Text>
              </Pressable>
            </Row>
          ) : (
            <Text style={{ fontWeight: "700", color: colors.primaryHover }}>
              {`Operatör: ${operator || "—"}`}
            </Text>
          )}
        </View>
      )}
      <GroupedSelect
        label="İstasyon"
        testID="shopfloor-station"
        value={station}
        onChange={setStation}
        groups={stationGroups}
        emptyLabel="Tüm istasyonlar"
      />
      <Text testID="shopfloor-project" style={{ height: 0, width: 0, opacity: 0 }}>{projectId}</Text>
      <Text testID="shopfloor-recipe" style={{ height: 0, width: 0, opacity: 0 }}>{recipeId}</Text>
      <Pressable testID="shopfloor-focus-open" onPress={() => setFocusOpen(true)} style={{ minHeight: 44, alignSelf: "flex-start", borderWidth: 2, borderColor: "#CBD5E1", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, justifyContent: "center" }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>Sıradaki iş</Text>
      </Pressable>
      <View testID="shopfloor-filters" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable
          testID="shopfloor-filter-all"
          onPress={() => { setProjectId(""); setRecipeId(""); setFilterMenu(""); }}
          style={{ minHeight: 44, borderRadius: 999, borderWidth: 2, paddingHorizontal: 14, justifyContent: "center", borderColor: !projectId && !recipeId ? "#0F172A" : "#CBD5E1", backgroundColor: !projectId && !recipeId ? "#0F172A" : "#fff" }}
        >
          <Text style={{ fontWeight: "700", color: !projectId && !recipeId ? "#fff" : colors.text }}>Tümü</Text>
        </Pressable>
        <Pressable
          testID="shopfloor-filter-project"
          onPress={() => setFilterMenu((cur) => (cur === "project" ? "" : "project"))}
          style={{ minHeight: 44, borderRadius: 999, borderWidth: 2, paddingHorizontal: 14, justifyContent: "center", borderColor: filterMenu === "project" || projectId ? "#0F172A" : "#CBD5E1", backgroundColor: filterMenu === "project" || projectId ? "#0F172A" : "#fff" }}
        >
          <Text style={{ fontWeight: "700", color: filterMenu === "project" || projectId ? "#fff" : colors.text }}>Proje ▾</Text>
        </Pressable>
        <Pressable
          testID="shopfloor-filter-recipe"
          onPress={() => setFilterMenu((cur) => (cur === "recipe" ? "" : "recipe"))}
          style={{ minHeight: 44, borderRadius: 999, borderWidth: 2, paddingHorizontal: 14, justifyContent: "center", borderColor: filterMenu === "recipe" || recipeId ? "#0F172A" : "#CBD5E1", backgroundColor: filterMenu === "recipe" || recipeId ? "#0F172A" : "#fff" }}
        >
          <Text style={{ fontWeight: "700", color: filterMenu === "recipe" || recipeId ? "#fff" : colors.text }}>Reçete ▾</Text>
        </Pressable>
      </View>
      <FilterMenu
        open={filterMenu === "project" || filterMenu === "recipe"}
        selectedId={filterMenu === "recipe" ? recipeId : projectId}
        onPick={(id) => {
          if (filterMenu === "recipe") setRecipeId(id);
          else setProjectId(id);
          setFilterMenu("");
        }}
        rows={(filterMenu === "recipe" ? filterCatalog.recipes : filterCatalog.projects).map((row) => {
          const id = String(filterMenu === "recipe" ? row.recipe_id : row.project_id);
          const tone = projectColor(filterMenu === "recipe" ? id : row.project_id);
          const full = filterMenu === "recipe" ? recipeFilterLabel(row) : projectFilterLabel(row);
          return {
            id,
            label: full.replace(/\s*\(\d+\)\s*$/, ""),
            count: `${Number(row.job_count) || 0} iş`,
            wash: tone.wash,
            edge: tone.stripe,
          };
        })}
      />
      <Card testID="shopfloor-group-station-wrap">
        <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Aynı istasyonu peşi sıra işle</Text>
            <Muted>Açıkken iş emirleri istasyona göre gruplanır; kalan adımlar peşi sıra yeniden sıralanır.</Muted>
          </View>
          <Switch
            value={groupSameStation}
            disabled={groupBusy}
            onValueChange={toggleGroupSameStation}
            testID="shopfloor-group-same-station"
          />
        </Row>
      </Card>
      {operator && pausePolicy?.allowed === false ? (
        <Card testID="shopfloor-pause-blocked" style={{ backgroundColor: "#F1F5F9" }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>
            Duraklat kapalı: {pausePolicy?.reason || "Mesai / mola / fazla mesai dışında."}
            {pausePolicy?.deadline ? ` (otomatik: ${pausePolicy.deadline})` : ""}
          </Text>
        </Card>
      ) : null}
      {operator && pausePolicy?.allowed && pausePolicy?.phase && pausePolicy.phase !== "mesai" ? (
        <Card testID="shopfloor-pause-phase" style={{ backgroundColor: "#FFF7ED" }}>
          <Text style={{ fontWeight: "700", color: "#9A3412" }}>
            Duraklat aktif — {shopFloorPausePhaseLabel(pausePolicy.phase)}
            {pausePolicy.deadline ? ` · otomatik ${pausePolicy.deadline}` : ""}
          </Text>
        </Card>
      ) : null}
      <ErrorBanner message={sessionNote || error} />
      {notice ? (
        <Card testID="shopfloor-notice" style={{ backgroundColor: colors.emerald50 }}>
          <Text style={{ fontWeight: "700", color: colors.primaryHover }}>{notice}</Text>
        </Card>
      ) : null}
      {duties.length ? (
        <View testID="shopfloor-duties">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>
              {showArchivedDuties
                ? `Arşiv · ${archivedDuties.length} tamamlanan`
                : `Atanan Görevler (${openDuties.length} açık)`}
            </Text>
            {archivedDuties.length ? (
              <Pressable
                testID="shopfloor-duties-archive-toggle"
                onPress={() => setShowArchivedDuties((v) => !v)}
                style={{ paddingVertical: 4 }}
              >
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                  {showArchivedDuties ? "Açık görevler" : `Arşiv (${archivedDuties.length})`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {!visibleDuties.length ? (
            <Muted>{showArchivedDuties ? "Arşivde tamamlanan görev yok." : "Açık görev kalmadı."}</Muted>
          ) : (
            visibleDuties.map((t, i) => (
              <AssignedDutyCard
                key={t.id || String(i)}
                duty={t}
                index={i}
                testID={`shopfloor-duty-${t.id || i}`}
                reportSitePresence
                approveBusy={dutyBusyId === t.id}
                onApprove={() => approveDuty(t)}
                onChanged={() => load()}
              />
            ))
          )}
        </View>
      ) : null}

      <View
        testID="shopfloor-kpis"
        style={{ flexDirection: "row", gap: 8 }}
      >
        {kpiItems.map((item) => {
          const selected = kpi === item.key;
          return (
            <Pressable
              key={item.key}
              testID={item.testID}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setKpi((cur) => (cur === item.key ? null : item.key))}
              style={{
                flex: 1,
                minHeight: 64,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                paddingHorizontal: 6,
                paddingVertical: 10,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: selected ? "#F59E0B" : colors.border,
                backgroundColor: selected ? colors.amber50 : colors.surface,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, textAlign: "center" }} numberOfLines={2}>{trUpper(item.label)}</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", color: item.valueColor, textAlign: "center" }}>{item.value}</Text>
            </Pressable>
          );
        })}
      </View>

      {arrangedMine.length ? (
        <View testID="shopfloor-mine">
          <Text style={{ fontWeight: "800", color: colors.text }}>Benim İşlerim ({arrangedMine.length})</Text>
          {renderGrouped(arrangedMine, (w) => renderWo(w))}
        </View>
      ) : null}

      <Text style={{ fontWeight: "800", color: colors.text }}>Açık İş Emirleri ({arrangedOthers.length})</Text>
      {error ? null : !parts.active.length && kpi == null ? (
        <Empty icon="build-outline" title="Bekleyen iş emri yok" hint="Üretim & Reçete sayfasından üretim emri verin." />
      ) : renderGrouped(arrangedOthers, (w) => renderWo(w))}

      {arrangedWaiting.length ? (
        <View testID="shopfloor-waiting">
          <Text style={{ fontWeight: "800", color: colors.muted }}>Sıradaki Adımlar ({arrangedWaiting.length})</Text>
          {renderGrouped(arrangedWaiting, (w) => renderWo(w))}
        </View>
      ) : null}

      <Text testID="shopfloor-color-note" style={{ fontSize: 12, color: colors.muted }}>
        Renk: istasyon = dolu etiket · proje = kartın sol kenarı + çerçeveli etiket
      </Text>

      {parts.done.length > 0 ? (
        <Pressable onPress={trashCompleted} disabled={trashBusy} testID="shopfloor-trash-done" style={{ minHeight: 40, justifyContent: "center" }}>
          <Text style={{ fontWeight: "700", color: "#E11D48" }}>
            {trashBusy ? "Çöpe taşınıyor…" : `Tamamlananları çöpe taşı (${parts.done.length})`}
          </Text>
          <Muted>Çöp kutusundan 30 gün içinde geri getirilebilir.</Muted>
        </Pressable>
      ) : null}

      <Modal visible={atolye && !!pendingOp} transparent animationType="fade" onRequestClose={cancelUnlock}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={cancelUnlock}>
          <Pressable
            testID="shopfloor-pin-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <ShopfloorPinPad
              operatorName={pendingOp?.name || ""}
              station={pendingOp?.station}
              error={unlockErr}
              busy={unlockBusy}
              onSubmit={(pin) => { void submitPin(pin); }}
              onCancel={cancelUnlock}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!trashTarget} transparent animationType="fade" onRequestClose={cancelTrashRequest}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={cancelTrashRequest}>
          <Pressable
            testID="wo-trash-request-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>Yönetici onayına gönder</Text>
            <Muted>{[trashTarget?.order_code, trashTarget?.step_name].filter(Boolean).join(" · ")}</Muted>
            <Muted>Talep yöneticiye iletilir; onaylanınca üretim emri ve adımlar çöp kutusuna taşınır.</Muted>
            <ErrorBanner message={trashReqErr} />
            <Row>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Vazgeç" onPress={cancelTrashRequest} color={colors.muted} testID="wo-trash-request-cancel" />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Onaya gönder"
                  onPress={confirmTrashRequest}
                  disabled={trashReqBusy}
                  loading={trashReqBusy}
                  color="#E11D48"
                  testID="wo-trash-request-confirm"
                />
              </View>
            </Row>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!finishing} transparent animationType="fade" onRequestClose={() => setFinishing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={() => setFinishing(null)}>
          <Pressable
            testID="wo-finish-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>{finishing?.step_name} — Bitir</Text>
            <Muted>
              {(() => {
                const plan = finishing ? workOrderFinishPlan(finishing) : null;
                const planTxt = plan ? `Plan ${plan.qty} ${plan.unit}${plan.isMaterial && plan.materialName ? ` (${plan.materialName})` : ""}` : null;
                return [finishing?.order_code, finishing?.product_name, planTxt].filter(Boolean).join(" · ");
              })()}
            </Muted>
            <Row>
              <View style={{ flex: 1 }}>
                <QuantityInput
                  label={`Üretilen (${finishing ? workOrderFinishPlan(finishing).unit : "adet"})`}
                  testID="wo-finish-produced"
                  value={fin.produced_qty}
                  onChange={(n) => setFin((f) => ({ ...f, produced_qty: n ?? "" }))}
                  compact
                />
              </View>
              <View style={{ flex: 1 }}>
                <QuantityInput
                  label="Fire / Hatalı"
                  testID="wo-finish-scrap"
                  value={fin.scrap_qty}
                  onChange={(n) => setFin((f) => ({ ...f, scrap_qty: n ?? "" }))}
                  compact
                />
              </View>
            </Row>
            {Number(fin.scrap_qty) > 0 ? (
              <View testID="wo-finish-scrap-reasons" style={{ gap: 8 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>Fire neden oldu?</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {normalizeScrapReasons(shopSettings.scrap_reasons).map((reason) => {
                    const on = scrapReason?.code === reason.code;
                    return (
                      <Pressable
                        key={reason.code}
                        testID={`wo-scrap-reason-${reason.code}`}
                        onPress={() => setScrapReason(reason)}
                        style={{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: on ? "#2563EB" : "#CBD5E1", backgroundColor: on ? "#EFF6FF" : "#fff", paddingHorizontal: 12, justifyContent: "center" }}
                      >
                        <Text style={{ fontWeight: "600", color: on ? "#1D4ED8" : colors.text }}>{reason.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {finishing && (() => {
              const plan = workOrderFinishPlan(finishing);
              const entered = Number(fin.produced_qty) + Number(fin.scrap_qty || 0);
              const over = finishOverPlan(Number(fin.produced_qty), Number(fin.scrap_qty || 0), plan.qty);
              const under = Number(plan.qty || 0) > 0 && entered < Number(plan.qty || 0) - 1e-9;
              if (!over && !under) return null;
              return (
                <Card
                  testID={over ? "wo-finish-over-hint" : "wo-finish-under-hint"}
                  style={{ backgroundColor: over ? "#FFFBEB" : "#F0F9FF", borderColor: over ? "#FDE68A" : "#BAE6FD" }}
                >
                  <Muted>
                    {over ? "Plan üstü" : "Plan altı"}: {plan.qty} {plan.unit} planlandı, siz {entered} giriyorsunuz — stok buna göre işlenir.
                  </Muted>
                </Card>
              );
            })()}
            <Field
              label="Not"
              testID="wo-finish-notes"
              value={fin.notes}
              onChangeText={(v) => setFin((f) => ({ ...f, notes: v }))}
              placeholder="İsteğe bağlı"
            />
            {finishLast ? (
              <Card style={{ backgroundColor: colors.emerald50 }}>
                <Muted>
                  {(() => {
                    const plan = finishing ? workOrderFinishPlan(finishing) : null;
                    if (plan?.isMaterial) {
                      return `Son adım: girilen hammadde stoğundan düşülür; mamul stoka ${finishing?.planned_quantity ?? ""} ${finishing?.unit || ""} yazılır.`.trim();
                    }
                    return "Son adım: üretilen miktar mamul stoğa eklenir, hammaddeler buna göre düşülür (fazla/eksik dahil).";
                  })()}
                </Muted>
              </Card>
            ) : finishing && workOrderFinishPlan(finishing).isMaterial ? (
              <Card style={{ backgroundColor: colors.slate50 }}>
                <Muted>Hammadde adımı: girilen üretilen + fire miktarı stoktan hemen düşülür.</Muted>
              </Card>
            ) : null}
            <Row>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="İptal" onPress={() => setFinishing(null)} color={colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Tamamla" onPress={confirmFinish} color={colors.primary} testID="wo-finish-confirm" />
              </View>
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
      {partialJob ? (
        <PartialCountDialog
          job={partialJob}
          unit={workOrderFinishPlan(partialJob).unit}
          busy={partialBusy}
          onClose={() => { if (!partialBusy) setPartialJob(null); }}
          onSubmit={(qty) => { void submitPartial(qty); }}
        />
      ) : null}
      {takeover ? (
        <TakeoverDialog
          job={takeover.w}
          detail={takeover.detail}
          busy={busyId === woCardKey(takeover.w)}
          onClose={() => setTakeover(null)}
          onConfirm={() => { void act(takeover.w, takeover.action, { ...(takeover.body || {}), confirm_takeover: true }); }}
        />
      ) : null}
      {drawing ? (
        <DrawingViewer
          title={drawing.title}
          filename={drawing.filename}
          expiresIn={drawing.expiresIn}
          url={drawing.url}
          contentType={drawing.contentType}
          onClose={() => setDrawing(null)}
        />
      ) : null}
      {undoToast && undoLeft ? (
        <UndoToast text={undoToast.text} countdown={undoLeft} onUndo={() => { void undoWork(undoToast.workOrder); }} />
      ) : null}
      {idleLocked && operatorSession ? (
        <IdleLock
          name={operatorSession.operator_name || operator}
          code={operatorCode}
          minutes={Number(shopSettings.idle_lock_minutes) || 30}
          error={idleErr}
          busy={idleBusy}
          onSubmit={(pin) => { void submitIdlePin(pin); }}
          onSwitch={() => { setIdleLocked(false); setIdleErr(""); logoutOperator(); }}
        />
      ) : null}
      {focusOpen ? (
        <FocusBoard
          mode={pickedFocus?.mode || "next"}
          title={pickedFocus?.job ? cardTitle(pickedFocus.job).text : "Sıradaki iş yok"}
          step={pickedFocus?.job?.step_name || pickedFocus?.job?.station}
          meta={pickedFocus?.job?.sales_order_no ? `Sipariş no: ${pickedFocus.job.sales_order_no}` : pickedFocus?.job?.order_code}
          qtyLabel={pickedFocus?.job && focusPlan ? (workOrderQtyLabel(pickedFocus.job, focusPlan) || `${formatQty(focusPlan.qty)} ${focusPlan.unit}`) : ""}
          passive={!mayOperate || !pickedFocus?.job || (atolye && !operator)}
          onBack={() => setFocusOpen(false)}
          onStart={() => { if (pickedFocus?.job) void act(pickedFocus.job, "start"); }}
          onFinish={() => {
            if (!pickedFocus?.job) return;
            setFocusOpen(false);
            openFinish(pickedFocus.job);
          }}
          onDrawing={() => { if (pickedFocus?.job) void openDrawing(pickedFocus.job); }}
        />
      ) : null}
    </Screen>
  );
}
