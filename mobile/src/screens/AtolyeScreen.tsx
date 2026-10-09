import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, AppState, Image, Modal, Pressable, Switch, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { GroupedSelect } from "../components/GroupedSelect";
import { ProductionAiAdvisor } from "../components/ProductionAiAdvisor";
import { Badge, Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen, StatRows } from "../components/kit";
import { colors, radius, spacing } from "../theme";
import { archivedAssignedDuties, openAssignedDuties, type AssignedDuty } from "../utils/assignedDuty";
import { resolveMediaUrl } from "../utils/media";
import { fmtDate, idOf } from "../utils/money";
import type { Employee } from "../utils/personnel";
import {
  employeeLabel,
  finishOverPlan,
  finishQtyError,
  formatQty,
  groupWorkOrdersByStation,
  mergeSelfEmployee,
  partitionWorkOrders,
  readyCount,
  roundNeededQty,
  runningCount,
  shopFloorCardBorder,
  shopFloorOperators,
  shopFloorPausePhaseLabel,
  shopFloorStationSections,
  todayDoneCount,
  woCardKey,
  workOrderFinishPlan,
  woStatusTone,
  woStatusTr,
  type PausePolicy,
  type WorkOrder,
} from "../utils/shopFloor";
import { stationNamesFromParks } from "../utils/workParks";

function WoCard({
  w,
  operator,
  busy,
  baseUrl,
  pauseAllowed,
  pauseHint,
  onStart,
  onPause,
  onFinish,
  onTrash,
}: {
  w: WorkOrder;
  operator: string;
  busy: boolean;
  baseUrl: string;
  pauseAllowed?: boolean;
  pauseHint?: string;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
  onTrash?: () => void;
}) {
  const key = woCardKey(w);
  const border = shopFloorCardBorder(w.status);
  const borderWide = w.status === "in_progress" || w.status === "paused";
  const who = w.operator_name || w.assigned_name;
  const imgs = (w.images || []).map((u) => resolveMediaUrl(baseUrl, u)).filter(Boolean).slice(0, 8);
  return (
    <Card testID={`wo-card-${key}`} style={{ borderColor: border, borderWidth: borderWide ? 2 : 1 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Muted>{[w.order_code, w.step_no != null ? `Adım ${w.step_no}/${w.step_count || w.step_no}` : null].filter(Boolean).join(" · ")}</Muted>
          <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{w.step_name || "İş emri"}</Text>
          <Muted>{w.product_name || ""}</Muted>
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
            <Pressable onPress={onTrash} testID={`wo-trash-${key}`} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: "#E11D48", fontWeight: "800", fontSize: 12 }}>Sil</Text>
            </Pressable>
          ) : null}
          <Badge label={woStatusTr(w.status)} tone={woStatusTone(w.status)} />
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
        {String(w.step_note || "").trim() ? (
          <View testID={`wo-step-note-${key}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, width: "100%", maxWidth: "100%" }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Adım notu:</Text>
            <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 12, fontWeight: "700", color: "#92400E" }}>
              {String(w.step_note).trim()}
            </Text>
          </View>
        ) : null}
      </View>
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
      {imgs.length > 0 ? (
        <View testID={`wo-images-${key}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {imgs.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: "#E2E8F0" }} />
          ))}
        </View>
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
          w.elapsed_min != null ? `${w.elapsed_min} dk geçti` : null,
          who,
          w.planned_date ? `Plan: ${fmtDate(w.planned_date)}` : null,
        ].filter(Boolean).join(" · ")}
      </Muted>
      {w.notes ? <Muted>{w.notes}</Muted> : null}
      {w.status === "ready" || w.status === "waiting" ? (
        <>
          <PrimaryButton title="Başla" onPress={onStart} disabled={!operator || busy} loading={busy} color={colors.primary} testID={`wo-start-${key}`} />
          {w.status === "waiting" ? <Muted>Önceki adım bitmeden de başlatılabilir</Muted> : null}
        </>
      ) : null}
      {w.status === "in_progress" || w.status === "paused" ? (
        <Row>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              title={w.status === "paused" ? "Devam" : "Duraklat"}
              onPress={w.status === "paused" ? onStart : onPause}
              disabled={!operator || busy || (w.status === "in_progress" && pauseAllowed === false)}
              loading={busy}
              color={w.status === "paused" ? colors.primary : "#EA580C"}
              testID={w.status === "paused" ? `wo-resume-${key}` : `wo-pause-${key}`}
            />
            {w.status === "in_progress" && pauseAllowed === false && pauseHint ? (
              <Muted>{pauseHint}</Muted>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton title="Bitir" onPress={onFinish} disabled={!operator || busy} color={colors.secondary} testID={`wo-finish-${key}`} />
          </View>
        </Row>
      ) : null}
      {w.status === "done" ? (
        <Muted>
          {w.produced_qty != null ? `${w.produced_qty} üretildi` : "Tamamlandı"}
          {w.scrap_qty ? `, ${w.scrap_qty} fire` : ""}
          {w.operator_name ? ` · ${w.operator_name}` : ""}
        </Muted>
      ) : null}
    </Card>
  );
}

export function AtolyeScreen() {
  const { client, companyId, user, baseUrl } = useAuth();
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [operator, setOperator] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [station, setStation] = useState("");
  const [pendingEmp, setPendingEmp] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const [finishing, setFinishing] = useState<WorkOrder | null>(null);
  const [fin, setFin] = useState({ produced_qty: "", scrap_qty: "0", notes: "" });
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashTarget, setTrashTarget] = useState<WorkOrder | null>(null);
  const [trashReqBusy, setTrashReqBusy] = useState(false);
  const [trashReqErr, setTrashReqErr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duties, setDuties] = useState<AssignedDuty[]>([]);
  const [dutyBusyId, setDutyBusyId] = useState<string | null>(null);
  const [showArchivedDuties, setShowArchivedDuties] = useState(false);
  const [groupSameStation, setGroupSameStation] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [pausePolicy, setPausePolicy] = useState<PausePolicy>({ allowed: true, phase: "mesai" });

  const loadPausePolicy = useCallback(async (opName: string) => {
    if (!opName) {
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
  }, [client, companyId]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [w, e, s, parks, me, settings] = await Promise.all([
        get<WorkOrder[]>(client, "/production/work-orders", {
          company_id: companyId,
          station: station || undefined,
        }).catch(() => []),
        get<Employee[]>(client, "/personnel/employees", { company_id: companyId }).catch(() => []),
        get<string[]>(client, "/production/work-orders/stations", { company_id: companyId }).catch(() => []),
        get<{ parks?: unknown[] }>(client, `/companies/${companyId}/work-parks`).catch(() => ({ parks: [] })),
        get<{ employee?: Employee; tasks?: AssignedDuty[] }>(client, "/personnel/me").catch(() => null),
        get<{ group_same_station?: boolean }>(client, "/production/work-orders/shopfloor-settings", { company_id: companyId }).catch(() => null),
      ]);
      setWos(Array.isArray(w) ? w : []);
      setEmployees(shopFloorOperators(mergeSelfEmployee(Array.isArray(e) ? e : [], me?.employee)));
      setStations(stationNamesFromParks(parks?.parks, Array.isArray(s) ? s : []));
      setDuties(Array.isArray(me?.tasks) ? me.tasks : []);
      if (settings && typeof settings.group_same_station === "boolean") setGroupSameStation(settings.group_same_station);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "İş emirleri yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, station]);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 5000);
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") load();
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

  const requestOperator = (id: string) => {
    if (!id) {
      setOperator("");
      setOperatorId("");
      setPendingEmp(null);
      setPin("");
      setUnlockErr("");
      return;
    }
    if (id === operatorId) return;
    const emp = employees.find((row) => idOf(row) === id);
    if (!emp) return;
    setPendingEmp(emp);
    setPin("");
    setUnlockErr("");
  };

  const cancelUnlock = () => {
    setPendingEmp(null);
    setPin("");
    setUnlockErr("");
  };

  const unlockOperator = async () => {
    if (!pendingEmp) return;
    if (pin.trim().length < 4) {
      setUnlockErr("Şifre en az 4 karakter olmalı.");
      return;
    }
    setUnlockBusy(true);
    setUnlockErr("");
    try {
      const r = await post<{ operator_name?: string }>(client, "/production/work-orders/shopfloor-unlock", {
        company_id: companyId,
        employee_id: idOf(pendingEmp),
        password: pin,
      });
      const name = r.operator_name || pendingEmp.full_name || "";
      setOperator(name);
      setOperatorId(idOf(pendingEmp));
      setPendingEmp(null);
      setPin("");
      setNotice(`${name} olarak giriş yapıldı.`);
      await loadPausePolicy(name);
    } catch (err) {
      setUnlockErr(apiErrorMessage(err, "Şifre doğrulanamadı."));
      setPin("");
    } finally {
      setUnlockBusy(false);
    }
  };

  const act = async (w: WorkOrder, action: "start" | "pause" | "finish", body?: Record<string, unknown>) => {
    if (!operator) {
      setError("Önce operatör (personel) seçin.");
      return;
    }
    const wid = idOf(w);
    if (!wid) {
      setError("İş emri kimliği bulunamadı.");
      return;
    }
    const key = woCardKey(w);
    setBusyId(key);
    try {
      const r = await post<{ message?: string; work_order?: WorkOrder }>(client, `/production/work-orders/${wid}/${action}`, {
        operator_name: operator,
        ...(body || {}),
      });
      setNotice(r.message || "İşlem tamamlandı.");
      setError(null);
      setFinishing(null);
      // Web tablete hemen yansısın diye yerel durumu anında güncelle
      if (r.work_order && idOf(r.work_order)) {
        const uid = idOf(r.work_order);
        setWos((prev) => prev.map((x) => (idOf(x) === uid ? { ...x, ...r.work_order } : x)));
      } else if (action === "finish") {
        setWos((prev) => prev.map((x) => (idOf(x) === wid ? { ...x, status: "done" } : x)));
      }
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const openFinish = (w: WorkOrder) => {
    const plan = workOrderFinishPlan(w);
    setFinishing(w);
    setFin({ produced_qty: String(plan.qty ?? 0), scrap_qty: "0", notes: "" });
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
    act(finishing, "finish", { produced_qty: produced, scrap_qty: scrap, notes: fin.notes });
  };

  const parts = useMemo(() => partitionWorkOrders(wos, operator), [wos, operator]);
  const arrangedMine = useMemo(
    () => (groupSameStation ? groupWorkOrdersByStation(parts.mine) : parts.mine),
    [groupSameStation, parts.mine],
  );
  const arrangedOthers = useMemo(
    () => (groupSameStation ? groupWorkOrdersByStation(parts.others) : parts.others),
    [groupSameStation, parts.others],
  );
  const arrangedWaiting = useMemo(
    () => (groupSameStation ? groupWorkOrdersByStation(parts.waiting) : parts.waiting),
    [groupSameStation, parts.waiting],
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
  const empGroups = useMemo(
    () => [{ label: "Personel", options: employees.map((e) => ({ value: idOf(e), label: employeeLabel(e) })).filter((o) => o.value) }],
    [employees],
  );
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
    if (!operator) {
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
    setTrashReqBusy(true);
    setTrashReqErr("");
    try {
      const r = await post<{ message?: string }>(client, `/production/work-orders/${wid}/trash-request`, {
        company_id: companyId,
        operator_name: operator,
      });
      setNotice(r.message || "Silme talebi yöneticiye gönderildi.");
      setError(null);
      cancelTrashRequest();
      await load();
    } catch (err) {
      setTrashReqErr(apiErrorMessage(err, "Talep gönderilemedi."));
    } finally {
      setTrashReqBusy(false);
    }
  };

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <ProductionAiAdvisor companyId={companyId} compact />
      <GroupedSelect
        label="Operatör"
        testID="shopfloor-operator"
        value={pendingEmp ? idOf(pendingEmp) : operatorId}
        onChange={requestOperator}
        groups={empGroups}
        emptyLabel="Operatör seçin…"
      />
      <GroupedSelect
        label="İstasyon"
        testID="shopfloor-station"
        value={station}
        onChange={setStation}
        groups={stationGroups}
        emptyLabel="Tüm istasyonlar"
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
      {!operator ? (
        <Card testID="shopfloor-no-operator" style={{ backgroundColor: colors.amber50 }}>
          <Text style={{ fontWeight: "700", color: "#92400E" }}>Başlamak için operatörü seçin ve şifrenizi girin.</Text>
        </Card>
      ) : (
        <Muted testID="shopfloor-operator-name">{operator}{user?.employee_id === operatorId ? " · siz" : ""}</Muted>
      )}
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
      <ErrorBanner message={error} />
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

      <StatRows
        testID="shopfloor-kpis"
        items={[
          { key: "ready", label: "Hazır", value: String(readyCount(wos)), valueColor: "#2563EB" },
          { key: "run", label: "Devam Eden", value: String(runningCount(wos)), valueColor: "#D97706" },
          { key: "done", label: "Bugün Biten", value: String(todayDoneCount(wos)), valueColor: colors.primaryHover },
        ]}
      />

      {parts.mine.length ? (
        <View testID="shopfloor-mine">
          <Text style={{ fontWeight: "800", color: colors.text }}>Benim İşlerim ({parts.mine.length})</Text>
          {renderGrouped(arrangedMine, (w) => (
            <WoCard
              key={woCardKey(w)}
              w={w}
              operator={operator}
              busy={busyId === woCardKey(w)}
              baseUrl={baseUrl}
              pauseAllowed={!!pausePolicy?.allowed}
              pauseHint={pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz"}
              onStart={() => act(w, "start")}
              onPause={() => act(w, "pause")}
              onFinish={() => openFinish(w)}
              onTrash={() => openTrashRequest(w)}
            />
          ))}
        </View>
      ) : null}

      <Text style={{ fontWeight: "800", color: colors.text }}>Açık İş Emirleri ({parts.others.length})</Text>
      {!parts.active.length ? (
        <Empty icon="build-outline" title="Bekleyen iş emri yok" hint="Üretim & Reçete sayfasından üretim emri verin." />
      ) : renderGrouped(arrangedOthers, (w) => (
        <WoCard
          key={woCardKey(w)}
          w={w}
          operator={operator}
          busy={busyId === woCardKey(w)}
          baseUrl={baseUrl}
          pauseAllowed={!!pausePolicy?.allowed}
          pauseHint={pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz"}
          onStart={() => act(w, "start")}
          onPause={() => act(w, "pause")}
          onFinish={() => openFinish(w)}
          onTrash={() => openTrashRequest(w)}
        />
      ))}

      {parts.waiting.length ? (
        <View testID="shopfloor-waiting">
          <Text style={{ fontWeight: "800", color: colors.muted }}>Sıradaki Adımlar ({parts.waiting.length})</Text>
          {renderGrouped(arrangedWaiting, (w) => (
            <WoCard
              key={woCardKey(w)}
              w={w}
              operator={operator}
              busy={false}
              baseUrl={baseUrl}
              onStart={() => {}}
              onPause={() => {}}
              onFinish={() => {}}
              onTrash={() => openTrashRequest(w)}
            />
          ))}
        </View>
      ) : null}

      {parts.done.length > 0 ? (
        <Pressable onPress={trashCompleted} disabled={trashBusy} testID="shopfloor-trash-done" style={{ minHeight: 40, justifyContent: "center" }}>
          <Text style={{ fontWeight: "700", color: "#E11D48" }}>
            {trashBusy ? "Çöpe taşınıyor…" : `Tamamlananları çöpe taşı (${parts.done.length})`}
          </Text>
          <Muted>Çöp kutusundan 30 gün içinde geri getirilebilir.</Muted>
        </Pressable>
      ) : null}

      <Modal visible={!!pendingEmp} transparent animationType="fade" onRequestClose={cancelUnlock}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={cancelUnlock}>
          <Pressable
            testID="shopfloor-pin-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>Operatör şifresi</Text>
            <Muted>{pendingEmp ? employeeLabel(pendingEmp) : ""}</Muted>
            <Muted>Mesaim girişi yapılmamış personel operatör olamaz.</Muted>
            <Field
              label="Şifre"
              testID="shopfloor-pin-input"
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              placeholder="••••"
              autoFocus
            />
            <ErrorBanner message={unlockErr} />
            <Row>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Vazgeç" onPress={cancelUnlock} color={colors.muted} testID="shopfloor-pin-cancel" />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Giriş"
                  onPress={unlockOperator}
                  disabled={unlockBusy || pin.length < 4}
                  loading={unlockBusy}
                  color={colors.primary}
                  testID="shopfloor-pin-submit"
                />
              </View>
            </Row>
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
                <Field
                  label={`Üretilen (${finishing ? workOrderFinishPlan(finishing).unit : "adet"})`}
                  testID="wo-finish-produced"
                  value={fin.produced_qty}
                  onChangeText={(v) => setFin((f) => ({ ...f, produced_qty: v }))}
                  keyboardType="decimal-pad"
                  compact
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Fire / Hatalı"
                  testID="wo-finish-scrap"
                  value={fin.scrap_qty}
                  onChangeText={(v) => setFin((f) => ({ ...f, scrap_qty: v }))}
                  keyboardType="decimal-pad"
                  compact
                />
              </View>
            </Row>
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
    </Screen>
  );
}
