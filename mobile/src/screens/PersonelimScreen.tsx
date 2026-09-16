import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, Empty, ErrorBanner, Field, H1, Kpi, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { leaveTr, statusTr } from "../utils/labels";
import { fmtMoney, idOf } from "../utils/money";

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
  bonuses?: { id?: string; _id?: string; type?: string; amount?: number; status?: string; period?: string; note?: string }[];
  balance?: {
    remaining?: number;
    unpaid_payroll?: number;
    bonus_pending?: number;
    meal_due?: number;
    transport_due?: number;
    advances?: number;
  } | null;
  tasks?: { id?: string; title?: string; done?: boolean; due_date?: string; project_name?: string; project_number?: string }[];
  work_orders?: { id?: string; order_code?: string; product_name?: string; station?: string; step_no?: number; status?: string; planned_date?: string; qty?: number }[];
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

  const submitLeave = async () => {
    setLeaveBusy(true);
    setError(null);
    setMessage(null);
    try {
      await post(client, "/personnel/leaves/self", {
        type: leaveType,
        start_date: startDate,
        end_date: endDate || startDate,
        reason,
      });
      setMessage("İzin talebi gönderildi.");
      setReason("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İzin talebi gönderilemedi."));
    } finally {
      setLeaveBusy(false);
    }
  };

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <H1>Personelim</H1>
      <Muted>
        {emp
          ? [emp.full_name, emp.department, emp.position].filter(Boolean).join(" · ")
          : "Hesabınız bir personel kartına bağlı değil"}
      </Muted>
      <Field
        label="Dönem (YYYY-AA)"
        testID="personelim-month"
        value={month}
        onChangeText={setMonth}
        placeholder="2026-09"
        autoCapitalize="none"
      />
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}

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
            <Field label="Başlangıç (YYYY-AA-GG)" testID="personelim-leave-start" value={startDate} onChangeText={setStartDate} placeholder="2026-09-16" autoCapitalize="none" />
            <Field label="Bitiş (YYYY-AA-GG)" testID="personelim-leave-end" value={endDate} onChangeText={setEndDate} placeholder="2026-09-16" autoCapitalize="none" />
            <Field label="Açıklama" testID="personelim-leave-reason" value={reason} onChangeText={setReason} placeholder="İsteğe bağlı" />
            <PrimaryButton title={leaveBusy ? "Gönderiliyor…" : "İzin talep et"} onPress={submitLeave} disabled={leaveBusy || !startDate} testID="personelim-leave-submit" />
          </Card>
          {leaves.slice(0, 8).map((l) => (
            <ListRow
              key={idOf(l) || `${l.start_date}-${l.end_date}`}
              title={`${leaveTr(l.type)} · ${l.days ?? "—"} gün`}
              subtitle={`${l.start_date || "—"} → ${l.end_date || "—"}${l.reason ? ` · ${l.reason}` : ""}`}
              right={statusTr(l.status)}
            />
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
          <Empty icon="checkbox-outline" title="Size atanmış proje görevi yok." />
        ) : (
          tasks.map((t, i) => (
            <ListRow
              key={t.id || String(i)}
              title={t.title || "Görev"}
              subtitle={[t.project_number, t.project_name, t.due_date ? `son ${t.due_date}` : null].filter(Boolean).join(" · ")}
              right={t.done ? "Tamam" : "Açık"}
            />
          ))
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
              subtitle={[w.product_name, w.station, w.step_no != null ? `adım ${w.step_no}` : null, w.planned_date].filter(Boolean).join(" · ")}
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
