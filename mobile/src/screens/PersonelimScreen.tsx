import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { DateField } from "../components/DateField";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { LocationConsentCard } from "../components/LocationConsentCard";
import { Card, Empty, ErrorBanner, Field, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { normalizeYmd } from "../utils/calendar";
import { leaveTr, statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { type AssignedDuty } from "../utils/assignedDuty";
import { locationConsentPayload, type LocationConsent, type LocationSignal } from "../utils/locationConsent";
import { advanceFormToggleIcon, advanceFormToggleLabel, advanceRequestPayload, leaveDays, selfLeavePayload, validateAdvance, validateSelfLeave } from "../utils/personnel";

type TabId = "ozet" | "alacak" | "gorevler" | "emirler" | "mesai";

type PersonelimPayload = {
  employee?: {
    full_name?: string;
    department?: string;
    position?: string;
  } | null;
  month?: string;
  compensation?: {
    salary?: number;
    second_salary?: number;
    meal_allowance?: number;
    transport_allowance?: number;
  } | null;
  attendance?: {
    days_present?: number;
    days_absent?: number;
    days_leave?: number;
    total_hours?: number;
    normal_hours?: number;
    overtime_hours?: number;
    late_count?: number;
    late_minutes?: number;
    off_day_count?: number;
  };
  leaves?: { id?: string; _id?: string; type?: string; start_date?: string; end_date?: string; days?: number; status?: string; reason?: string }[];
  leave_balance?: { annual?: number; used?: number; remaining?: number; pending?: number } | null;
  payrolls?: { id?: string; _id?: string; period?: string; status?: string; net_salary?: number; final_payable?: number; overtime_pay?: number; overtime_hours?: number; second_salary?: number }[];
  bonuses?: { id?: string; _id?: string; type?: string; amount?: number; status?: string; period?: string; note?: string; source?: string }[];
  balance?: {
    remaining?: number;
    unpaid_payroll?: number;
    bonus_pending?: number;
    meal_due?: number;
    transport_due?: number;
    advances?: number;
  } | null;
  tasks?: AssignedDuty[];
  work_orders?: { id?: string; order_code?: string; product_name?: string; station?: string; step_no?: number; status?: string; planned_date?: string; qty?: number }[];
  location_consent?: LocationConsent | null;
  location_signal?: LocationSignal | null;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "ozet", label: "Özet" },
  { id: "alacak", label: "Alacak" },
  { id: "gorevler", label: "Görevler" },
  { id: "emirler", label: "İş emri" },
  { id: "mesai", label: "Mesai" },
];

const LEAVE_TYPES = [
  { key: "annual", label: "Yıllık" },
  { key: "sick", label: "Hastalık" },
  { key: "unpaid", label: "Ücretsiz" },
  { key: "other", label: "Diğer" },
];

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : "#fff",
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export function PersonelimScreen() {
  const { client } = useAuth();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState<TabId>("ozet");
  const [data, setData] = useState<PersonelimPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [leaveType, setLeaveType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceNote, setAdvanceNote] = useState("");
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await get<PersonelimPayload>(client, "/personnel/me", { month });
      setData(res);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Personel bilgileri yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    if (TABS.some((t) => t.id === raw)) setTab(raw as TabId);
  }, [params.tab]);

  const emp = data?.employee;
  const bal = data?.balance;
  const att = data?.attendance || {};
  const leave = data?.leave_balance;
  const comp = data?.compensation;
  const tasks = data?.tasks || [];
  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const wos = data?.work_orders || [];
  const payrolls = data?.payrolls || [];
  const bonuses = data?.bonuses || [];
  const leaves = data?.leaves || [];
  const pendingAdvance = bonuses.find((b) => b.type === "advance" && b.source === "self" && b.status === "pending");
  const leaveDayCount = leaveDays(startDate, endDate || startDate);

  const completeTask = async (t: AssignedDuty) => {
    if (!t.id) { setError("Görev numarası yok."); return; }
    setTaskBusyId(t.id);
    setError(null);
    setMessage(null);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/me/tasks/${t.id}/complete`, {});
      setMessage(r.message || "Görev tamamlandı.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Görev tamamlanamadı."));
    } finally {
      setTaskBusyId(null);
    }
  };

  const submitLeave = async () => {
    const start = normalizeYmd(startDate);
    const end = normalizeYmd(endDate) || start;
    const invalid = validateSelfLeave(start, end);
    if (invalid) { setError(invalid); return; }
    setLeaveBusy(true);
    setError(null);
    setMessage(null);
    try {
      await post(client, "/personnel/leaves/self", selfLeavePayload(leaveType, start, end, reason));
      setMessage("İzin talebi gönderildi.");
      setReason("");
      setStartDate("");
      setEndDate("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İzin talebi gönderilemedi."));
    } finally {
      setLeaveBusy(false);
    }
  };

  const cancelLeave = async (id: string) => {
    if (!id) return;
    setLeaveBusy(true);
    setError(null);
    try {
      await del(client, `/personnel/leaves/self/${id}`);
      setMessage("İzin talebi iptal edildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İzin talebi iptal edilemedi."));
    } finally {
      setLeaveBusy(false);
    }
  };

  const submitAdvance = async () => {
    const invalid = validateAdvance(advanceAmount);
    if (invalid) { setError(invalid); return; }
    setAdvanceBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await post<{ message?: string }>(client, "/personnel/bonuses/self", advanceRequestPayload(advanceAmount, advanceNote, month));
      setMessage(r?.message || "Avans talebi gönderildi.");
      setAdvanceAmount("");
      setAdvanceNote("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Avans talebi gönderilemedi."));
    } finally {
      setAdvanceBusy(false);
    }
  };

  const acceptConsent = async () => {
    setConsentBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await post<{ message?: string }>(client, "/personnel/me/location-consent", locationConsentPayload());
      setMessage(r.message || "Sözleşmeler kabul edildi. Personel paneli kullanıma açıldı.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Sözleşme kaydedilemedi."));
    } finally {
      setConsentBusy(false);
    }
  };

  const cancelAdvance = async (id: string) => {
    setAdvanceBusy(true);
    setError(null);
    try {
      const r = await del<{ message?: string }>(client, `/personnel/bonuses/self/${id}`);
      setMessage(r?.message || "Talep iptal edildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Talep iptal edilemedi."));
    } finally {
      setAdvanceBusy(false);
    }
  };

  const advanceForm = (
    <Card testID="personelim-advance-form">
      <Pressable
        testID="personelim-advance-toggle"
        onPress={() => setAdvanceOpen((v) => !v)}
        accessibilityLabel={advanceFormToggleLabel(advanceOpen)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <View style={{ flex: 1 }}>
          <Muted>AVANS TALEBİ{pendingAdvance ? " · bekleyen talep" : ""}</Muted>
        </View>
        <Text style={{ fontSize: 12, fontWeight: "800", color: "#B45309" }}>{advanceFormToggleLabel(advanceOpen)}</Text>
        <View
          testID="personelim-advance-toggle-icon"
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: "#FDE68A",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={advanceFormToggleIcon(advanceOpen)} size={16} color="#B45309" />
        </View>
      </Pressable>
      {advanceOpen ? (
        pendingAdvance ? (
          <View style={{ gap: 8 }} testID="personelim-advance-pending">
            <Muted>Bekleyen talep: {fmtMoney(pendingAdvance.amount)}{pendingAdvance.note ? ` · ${pendingAdvance.note}` : ""}</Muted>
            <PrimaryButton
              title={advanceBusy ? "İptal ediliyor…" : "Talebi iptal et"}
              onPress={() => cancelAdvance(idOf(pendingAdvance))}
              color={colors.danger}
              testID="personelim-advance-cancel"
            />
          </View>
        ) : (
          <>
            <Field label="Tutar (₺)" testID="personelim-advance-amount" value={advanceAmount} onChangeText={setAdvanceAmount} keyboardType="numeric" placeholder="Örn: 5000" />
            <Field label="Açıklama" testID="personelim-advance-note" value={advanceNote} onChangeText={setAdvanceNote} placeholder="İsteğe bağlı" />
            <PrimaryButton title={advanceBusy ? "Gönderiliyor…" : "Avans talep et"} onPress={submitAdvance} disabled={advanceBusy} color="#D97706" testID="personelim-advance-submit" />
          </>
        )
      ) : (
        <Muted testID="personelim-advance-hidden">Gizli. Göz işaretine basınca form açılır.</Muted>
      )}
    </Card>
  );

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Muted>
        {emp
          ? [emp.full_name, emp.department, emp.position].filter(Boolean).join(" · ")
          : "Hesabınız bir personel kartına bağlı değil"}
      </Muted>
      <Field
        label="Aylık dönem"
        testID="personelim-month"
        value={month}
        onChangeText={setMonth}
        placeholder="2026-09"
        autoCapitalize="none"
      />
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      {emp ? (
        <LocationConsentCard
          consent={data?.location_consent}
          signal={data?.location_signal}
          onAccept={acceptConsent}
          busy={consentBusy}
          testID="personelim-consent"
        />
      ) : null}

      {!emp ? (
        <Card testID="personelim-no-employee">
          <Muted>Görev, iş emri ve alacaklarınızı görmek için yöneticinizin Personel kartından hesabınızı bağlaması gerekir.</Muted>
        </Card>
      ) : null}

      <Row style={{ flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const badge = t.id === "gorevler" ? openTasks.length : t.id === "emirler" ? wos.length : 0;
          return (
            <Chip
              key={t.id}
              testID={`personelim-tab-${t.id}`}
              label={badge ? `${t.label} ${badge}` : t.label}
              active={tab === t.id}
              onPress={() => setTab(t.id)}
            />
          );
        })}
      </Row>

      {emp && tab === "ozet" ? (
        <>
          <Row>
            <Kpi label="Kalan alacak" value={fmtMoney(bal?.remaining)} sub={`${month} dönemi`} />
            <Kpi label="Fazla mesai" value={`${att.overtime_hours || 0} sa`} sub={`${att.total_hours || 0} sa toplam`} />
          </Row>
          <Row>
            <Kpi label="Açık görev" value={String(openTasks.length)} sub={`${tasks.length} toplam`} />
            <Kpi label="İş emri" value={String(wos.length)} sub="aktif atamalar" />
          </Row>
          <Card>
            <Muted>ÜCRET</Muted>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>{fmtMoney(comp?.salary)}</Text>
            {comp?.second_salary ? <Muted>2. maaş: {fmtMoney(comp.second_salary)}</Muted> : null}
            {Number(comp?.meal_allowance) > 0 || Number(comp?.transport_allowance) > 0 ? (
              <Muted>Yemek {fmtMoney(comp?.meal_allowance)} · Yol {fmtMoney(comp?.transport_allowance)}</Muted>
            ) : null}
          </Card>
          <Card>
            <Muted>İZİN BAKİYESİ</Muted>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>{leave?.remaining ?? "—"} gün</Text>
            <Muted>Kullanılan {leave?.used ?? 0} / {leave?.annual ?? 0} · Bekleyen {leave?.pending ?? 0}</Muted>
          </Card>
          <Card>
            <Muted>İZİN TALEBİ</Muted>
            <Row style={{ flexWrap: "wrap" }}>
              {LEAVE_TYPES.map((t) => (
                <Chip key={t.key} label={t.label} active={leaveType === t.key} onPress={() => setLeaveType(t.key)} />
              ))}
            </Row>
            <DateField
              label="Başlangıç"
              testID="personelim-leave-start"
              value={startDate}
              onChangeText={(d) => {
                const next = normalizeYmd(d);
                setStartDate(next);
                if (!endDate || endDate < next) setEndDate(next);
              }}
            />
            <DateField label="Bitiş" testID="personelim-leave-end" value={endDate} min={startDate} onChangeText={(d) => setEndDate(normalizeYmd(d))} />
            <Field label="Açıklama" testID="personelim-leave-reason" value={reason} onChangeText={setReason} placeholder="İsteğe bağlı" />
            <PrimaryButton
              title={leaveBusy ? "Gönderiliyor…" : leaveDayCount ? `İzin talep et (${leaveDayCount} gün)` : "İzin talep et"}
              onPress={submitLeave}
              disabled={leaveBusy}
              testID="personelim-leave-submit"
            />
          </Card>
          {advanceForm}
          {leaves.slice(0, 8).map((l) => (
            <View key={idOf(l) || `${l.start_date}-${l.end_date}`}>
              <ListRow
                title={`${leaveTr(l.type)} · ${l.days ?? "—"} gün`}
                subtitle={`${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}${l.reason ? ` · ${l.reason}` : ""}`}
                right={statusTr(l.status)}
              />
              {l.status === "pending" ? (
                <Pressable
                  testID={`personelim-leave-cancel-${idOf(l)}`}
                  onPress={() => cancelLeave(idOf(l))}
                  style={{ alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 4 }}
                >
                  <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>Talebi iptal et</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {emp && tab === "alacak" ? (
        <>
          <Row>
            <Kpi label="Kalan toplam" value={fmtMoney(bal?.remaining)} />
            <Kpi label="Ödenmemiş bordro" value={fmtMoney(bal?.unpaid_payroll)} />
          </Row>
          <Row>
            <Kpi label="Bekleyen prim" value={fmtMoney(bal?.bonus_pending)} />
            <Kpi label="Avans" value={fmtMoney(bal?.advances)} />
          </Row>
          <Row>
            <Kpi label="Yemek alacağı" value={fmtMoney(bal?.meal_due)} />
            <Kpi label="Yol alacağı" value={fmtMoney(bal?.transport_due)} />
          </Row>
          {advanceForm}
          <Card>
            <Text style={{ fontWeight: "800", color: colors.text }}>Bordrolar</Text>
            {!payrolls.length ? <Muted>Bordro kaydı yok.</Muted> : payrolls.map((p) => (
              <ListRow
                key={idOf(p) || p.period}
                title={p.period || "Bordro"}
                subtitle={[
                  p.overtime_pay ? `Mesai ${fmtMoney(p.overtime_pay)}` : null,
                  p.second_salary ? `2. maaş ${fmtMoney(p.second_salary)}` : null,
                ].filter(Boolean).join(" · ") || undefined}
                right={`${fmtMoney(p.final_payable ?? p.net_salary)} · ${statusTr(p.status)}`}
              />
            ))}
          </Card>
          <Card>
            <Text style={{ fontWeight: "800", color: colors.text }}>Prim / Avans</Text>
            {!bonuses.length ? <Muted>Prim veya avans kaydı yok.</Muted> : bonuses.map((b) => (
              <ListRow
                key={idOf(b)}
                title={statusTr(b.type)}
                subtitle={[b.period, b.note].filter(Boolean).join(" · ") || undefined}
                right={`${fmtMoney(b.amount)} · ${statusTr(b.status)}`}
              />
            ))}
          </Card>
        </>
      ) : null}

      {emp && tab === "gorevler" ? (
        !tasks.length ? (
          <>
            <PrimaryButton
              title="Atölye ekranı"
              onPress={() => go("Atolye")}
              color={colors.secondary}
              testID="personelim-goto-atolye"
            />
            <Empty icon="checkbox-outline" title="Size atanmış proje görevi yok." />
          </>
        ) : (
          <>
            <PrimaryButton
              title="Atölye ekranı"
              onPress={() => go("Atolye")}
              color={colors.secondary}
              testID="personelim-goto-atolye"
            />
            {tasks.map((t, i) => (
              <AssignedDutyCard
                key={t.id || String(i)}
                duty={t}
                index={i}
                testID={`personelim-task-${t.id || i}`}
                showAtolye
                onAtolye={() => go("Atolye")}
                approveBusy={taskBusyId === t.id}
                onApprove={() => completeTask(t)}
                onChanged={() => load()}
              />
            ))}
          </>
        )
      ) : null}

      {emp && tab === "emirler" ? (
        !wos.length ? (
          <Empty icon="construct-outline" title="Size atanmış açık iş emri yok." />
        ) : (
          wos.map((w, i) => (
            <ListRow
              key={w.id || String(i)}
              title={w.order_code || w.id || "İş emri"}
              subtitle={[w.product_name, w.station, w.step_no != null ? `adım ${w.step_no}` : null, w.planned_date ? fmtDate(w.planned_date) : null].filter(Boolean).join(" · ")}
              right={statusTr(w.status)}
            />
          ))
        )
      ) : null}

      {emp && tab === "mesai" ? (
        <>
          <Row>
            <Kpi label="Çalışılan gün" value={String(att.days_present || 0)} sub={`${att.days_absent || 0} devamsız · ${att.days_leave || 0} izin`} />
            <Kpi label="Toplam saat" value={`${att.total_hours || 0} sa`} sub={`${att.normal_hours || 0} sa normal`} />
          </Row>
          <Row>
            <Kpi label="Fazla mesai" value={`${att.overtime_hours || 0} sa`} sub={att.off_day_count ? `${att.off_day_count} tatil günü` : "mesai dışı"} />
            <Kpi label="Geç kalma" value={String(att.late_count || 0)} sub={`${att.late_minutes || 0} dk toplam`} />
          </Row>
          <Card>
            <Muted>Giriş/çıkış için Mesaim ekranını kullanın.</Muted>
            <PrimaryButton title="Mesaim’e git" onPress={() => go("Mesai")} color={colors.accent} testID="personelim-open-mesai" />
          </Card>
        </>
      ) : null}

      {!emp && tab !== "ozet" ? (
        <View>
          <Muted>Personel kartı bağlanınca bu bölüm dolacak.</Muted>
        </View>
      ) : null}
    </Screen>
  );
}
