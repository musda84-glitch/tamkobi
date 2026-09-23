import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen, StatRows } from "../components/kit";
import { colors, radius, spacing } from "../theme";
import { dutyStatusLabel, dutySubtitle, openAssignedDuties, type AssignedDuty } from "../utils/assignedDuty";
import { idOf } from "../utils/money";
import type { Employee } from "../utils/personnel";
import {
  employeeLabel,
  finishQtyError,
  mergeSelfEmployee,
  partitionWorkOrders,
  readyCount,
  runningCount,
  todayDoneCount,
  woCardKey,
  woStatusTone,
  woStatusTr,
  type WorkOrder,
} from "../utils/shopFloor";

function WoCard({
  w,
  operator,
  busy,
  onStart,
  onPause,
  onFinish,
}: {
  w: WorkOrder;
  operator: string;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
}) {
  const key = woCardKey(w);
  const border =
    w.status === "in_progress" ? "#F59E0B" : w.status === "ready" ? "#C7D2FE" : colors.border;
  const who = w.operator_name || w.assigned_name;
  return (
    <Card testID={`wo-card-${key}`} style={{ borderColor: border, borderWidth: w.status === "in_progress" ? 2 : 1 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Muted>{[w.order_code, w.step_no != null ? `Adım ${w.step_no}/${w.step_count || w.step_no}` : null].filter(Boolean).join(" · ")}</Muted>
          <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{w.step_name || "İş emri"}</Text>
          <Muted>{w.product_name || ""}</Muted>
        </View>
        <Badge label={woStatusTr(w.status)} tone={woStatusTone(w.status)} />
      </Row>
      <Muted>
        {[
          w.station,
          w.planned_quantity != null ? `${w.planned_quantity} ${w.unit || ""}`.trim() : null,
          w.duration_min ? `Hedef ${w.duration_min} dk` : null,
          w.elapsed_min != null ? `${w.elapsed_min} dk geçti` : null,
          who,
          w.planned_date ? `Plan: ${w.planned_date}` : null,
        ].filter(Boolean).join(" · ")}
      </Muted>
      {w.notes ? <Muted>{w.notes}</Muted> : null}
      {w.status === "ready" ? (
        <PrimaryButton title="Başla" onPress={onStart} disabled={!operator || busy} loading={busy} color={colors.primary} testID={`wo-start-${key}`} />
      ) : null}
      {w.status === "in_progress" || w.status === "paused" ? (
        <Row>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              title={w.status === "paused" ? "Devam" : "Duraklat"}
              onPress={w.status === "paused" ? onStart : onPause}
              disabled={!operator || busy}
              loading={busy}
              color={w.status === "paused" ? colors.primary : "#EA580C"}
              testID={w.status === "paused" ? `wo-resume-${key}` : `wo-pause-${key}`}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton title="Bitir" onPress={onFinish} disabled={!operator || busy} color={colors.secondary} testID={`wo-finish-${key}`} />
          </View>
        </Row>
      ) : null}
      {w.status === "waiting" ? <Muted>Önceki adım tamamlanınca açılır</Muted> : null}
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
  const { client, companyId, user } = useAuth();
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
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duties, setDuties] = useState<AssignedDuty[]>([]);
  const [dutyBusyId, setDutyBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [w, e, s, me] = await Promise.all([
        get<WorkOrder[]>(client, "/production/work-orders", {
          company_id: companyId,
          station: station || undefined,
        }).catch(() => []),
        get<Employee[]>(client, "/personnel/employees", { company_id: companyId }).catch(() => []),
        get<string[]>(client, "/production/work-orders/stations", { company_id: companyId }).catch(() => []),
        get<{ employee?: Employee; tasks?: AssignedDuty[] }>(client, "/personnel/me").catch(() => null),
      ]);
      setWos(Array.isArray(w) ? w : []);
      setEmployees(mergeSelfEmployee(Array.isArray(e) ? e : [], me?.employee));
      setStations(Array.isArray(s) ? s : []);
      setDuties(Array.isArray(me?.tasks) ? me.tasks : []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "İş emirleri yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, station]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
    const key = woCardKey(w);
    setBusyId(key);
    try {
      const r = await post<{ message?: string }>(client, `/production/work-orders/${idOf(w)}/${action}`, {
        operator_name: operator,
        ...(body || {}),
      });
      setNotice(r.message || "İşlem tamamlandı.");
      setError(null);
      setFinishing(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const openFinish = (w: WorkOrder) => {
    setFinishing(w);
    setFin({ produced_qty: String(w.planned_quantity ?? 0), scrap_qty: "0", notes: "" });
  };

  const confirmFinish = () => {
    if (!finishing) return;
    const produced = Number(fin.produced_qty);
    const scrap = Number(fin.scrap_qty);
    const qtyErr = finishQtyError(produced, scrap, finishing.planned_quantity);
    if (qtyErr) {
      setError(qtyErr);
      return;
    }
    act(finishing, "finish", { produced_qty: produced, scrap_qty: scrap, notes: fin.notes });
  };

  const parts = useMemo(() => partitionWorkOrders(wos, operator), [wos, operator]);
  const empGroups = useMemo(
    () => [{ label: "Personel", options: employees.map((e) => ({ value: idOf(e), label: employeeLabel(e) })).filter((o) => o.value) }],
    [employees],
  );
  const stationGroups = useMemo(
    () => [{ label: "İstasyon", options: stations.map((s) => ({ value: s, label: s })) }],
    [stations],
  );

  const finishLast = finishing && finishing.step_no === finishing.step_count && (finishing.step_count || 0) > 0;
  const openDuties = useMemo(() => openAssignedDuties(duties), [duties]);

  const approveDuty = async (t: AssignedDuty) => {
    if (!t.id) {
      setError("Görev numarası yok.");
      return;
    }
    setDutyBusyId(t.id);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/me/tasks/${t.id}/complete`, {});
      setNotice(r.message || "Görev onaylandı.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Görev onaylanamadı."));
    } finally {
      setDutyBusyId(null);
    }
  };

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
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
      {!operator ? (
        <Card testID="shopfloor-no-operator" style={{ backgroundColor: colors.amber50 }}>
          <Text style={{ fontWeight: "700", color: "#92400E" }}>Başlamak için operatörü seçin ve şifrenizi girin.</Text>
        </Card>
      ) : (
        <Muted testID="shopfloor-operator-name">{operator}{user?.employee_id === operatorId ? " · siz" : ""}</Muted>
      )}
      <ErrorBanner message={error} />
      {notice ? (
        <Card testID="shopfloor-notice" style={{ backgroundColor: colors.emerald50 }}>
          <Text style={{ fontWeight: "700", color: colors.primaryHover }}>{notice}</Text>
        </Card>
      ) : null}
      {duties.length ? (
        <View testID="shopfloor-duties">
          <Text style={{ fontWeight: "800", color: colors.text }}>Atanan Görevler ({openDuties.length} açık)</Text>
          {duties.map((t, i) => (
            <Card key={t.id || String(i)} testID={`shopfloor-duty-${t.id || i}`} style={t.done ? { opacity: 0.7 } : undefined}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{t.title || "Görev"}</Text>
                  <Muted>{dutySubtitle(t)}</Muted>
                </View>
                <Badge label={dutyStatusLabel(t)} tone={t.done ? "green" : "indigo"} />
              </Row>
              {!t.done ? (
                <PrimaryButton
                  title="Onayla"
                  onPress={() => approveDuty(t)}
                  disabled={dutyBusyId === t.id}
                  loading={dutyBusyId === t.id}
                  color={colors.primary}
                  testID={`shopfloor-duty-approve-${t.id || i}`}
                />
              ) : (
                <Muted>Görev onaylandı.</Muted>
              )}
            </Card>
          ))}
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
          {parts.mine.map((w) => (
            <WoCard
              key={woCardKey(w)}
              w={w}
              operator={operator}
              busy={busyId === woCardKey(w)}
              onStart={() => act(w, "start")}
              onPause={() => act(w, "pause")}
              onFinish={() => openFinish(w)}
            />
          ))}
        </View>
      ) : null}

      <Text style={{ fontWeight: "800", color: colors.text }}>Açık İş Emirleri ({parts.others.length})</Text>
      {!parts.active.length ? (
        <Empty icon="build-outline" title="Bekleyen iş emri yok" hint="Üretim & Reçete sayfasından üretim emri verin." />
      ) : parts.others.map((w) => (
        <WoCard
          key={woCardKey(w)}
          w={w}
          operator={operator}
          busy={busyId === woCardKey(w)}
          onStart={() => act(w, "start")}
          onPause={() => act(w, "pause")}
          onFinish={() => openFinish(w)}
        />
      ))}

      {parts.waiting.length ? (
        <View testID="shopfloor-waiting">
          <Text style={{ fontWeight: "800", color: colors.muted }}>Sıradaki Adımlar ({parts.waiting.length})</Text>
          {parts.waiting.map((w) => (
            <WoCard
              key={woCardKey(w)}
              w={w}
              operator={operator}
              busy={false}
              onStart={() => {}}
              onPause={() => {}}
              onFinish={() => {}}
            />
          ))}
        </View>
      ) : null}

      <Pressable onPress={() => setShowDone((v) => !v)} testID="shopfloor-toggle-done" style={{ minHeight: 40, justifyContent: "center" }}>
        <Text style={{ fontWeight: "700", color: colors.muted }}>
          {showDone ? "Tamamlananları gizle" : `Tamamlananları göster (${parts.done.length})`}
        </Text>
      </Pressable>
      {showDone ? parts.done.slice(0, 30).map((w) => (
        <WoCard
          key={woCardKey(w)}
          w={w}
          operator={operator}
          busy={false}
          onStart={() => {}}
          onPause={() => {}}
          onFinish={() => {}}
        />
      )) : null}

      <Modal visible={!!pendingEmp} transparent animationType="fade" onRequestClose={cancelUnlock}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={cancelUnlock}>
          <Pressable
            testID="shopfloor-pin-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>Operatör şifresi</Text>
            <Muted>{pendingEmp ? employeeLabel(pendingEmp) : ""}</Muted>
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

      <Modal visible={!!finishing} transparent animationType="fade" onRequestClose={() => setFinishing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }} onPress={() => setFinishing(null)}>
          <Pressable
            testID="wo-finish-modal"
            onPress={() => { /* keep */ }}
            style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 8 }}
          >
            <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>{finishing?.step_name} — Bitir</Text>
            <Muted>
              {[finishing?.order_code, finishing?.product_name, finishing?.planned_quantity != null ? `Plan ${finishing.planned_quantity} ${finishing.unit || ""}`.trim() : null].filter(Boolean).join(" · ")}
            </Muted>
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label={`Üretilen (${finishing?.unit || "adet"})`}
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
            <Field
              label="Not"
              testID="wo-finish-notes"
              value={fin.notes}
              onChangeText={(v) => setFin((f) => ({ ...f, notes: v }))}
              placeholder="İsteğe bağlı"
            />
            {finishLast ? (
              <Card style={{ backgroundColor: colors.emerald50 }}>
                <Muted>Son adım: bitirince hammaddeler düşülür, üretilen miktar stoğa eklenir.</Muted>
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
