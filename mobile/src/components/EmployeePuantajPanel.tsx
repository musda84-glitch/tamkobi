import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import { attendanceCalendarMonth } from "../utils/attendanceSelf";
import { fmtDmy } from "../utils/calendar";
import {
  buildPuantajCalendarCells,
  leaveYearArchiveLine,
  PUANTAJ_WEEKDAYS,
  puantajStatusTone,
  puantajToneColors,
  type PuantajDay,
  type PuantajPayload,
} from "../utils/puantajMonth";
import { Field, Muted, PrimaryButton, Row } from "./kit";

function DayBadge({ status, label }: { status?: string | null; label?: string | null }) {
  const tone = puantajToneColors(puantajStatusTone(status));
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border }}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: tone.fg }}>{label || "—"}</Text>
    </View>
  );
}

export function EmployeePuantajPanel({
  employeeId,
  initialMonth,
  onLeaveYearChanged,
}: {
  employeeId?: string | null;
  initialMonth?: string | null;
  onLeaveYearChanged?: () => void;
}) {
  const { client } = useAuth();
  const [month, setMonth] = useState(() => initialMonth || attendanceCalendarMonth());
  const [view, setView] = useState<"table" | "calendar">("table");
  const [data, setData] = useState<PuantajPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (m = month) => {
    if (!employeeId) return;
    setBusy(true);
    try {
      const r = await get<PuantajPayload>(client, `/personnel/employees/${employeeId}/puantaj`, { month: m });
      setData(r);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj yüklenemedi."));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [client, employeeId, month]);

  useEffect(() => { void load(month); }, [employeeId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = data?.days || [];
  const cells = useMemo(() => buildPuantajCalendarCells(days), [days]);
  const summary = data?.summary || {};
  const leaveYear = data?.leave_year || {};
  const archives = data?.leave_archives || [];

  const rollover = async () => {
    const y = leaveYear.year || new Date().getFullYear();
    setArchiveBusy(true);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/employees/${employeeId}/leave-years/rollover`, {
        year: y,
        carry_remaining: true,
      });
      setMessage(r?.message || "Yıllık dönem arşivlendi.");
      setError(null);
      await load(month);
      onLeaveYearChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Arşivlenemedi."));
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <View testID="emp-puantaj-panel" style={{ gap: 10 }}>
      {error ? <Muted testID="emp-puantaj-error">{error}</Muted> : null}
      {message ? <Muted testID="emp-puantaj-message">{message}</Muted> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[
          { key: "present", label: "Çalışılan", value: summary.days_present ?? 0, color: "#065F46" },
          { key: "absent", label: "Devamsız", value: summary.days_absent ?? 0, color: "#9F1239" },
          { key: "leave", label: "İzinli", value: summary.days_leave ?? 0, color: "#92400E" },
          { key: "hours", label: "Saat / Mesai", value: `${summary.total_hours ?? 0} / ${summary.overtime_hours ?? 0}`, color: "#3730A3" },
        ].map((s) => (
          <View
            key={s.key}
            testID={`emp-puantaj-${s.key}`}
            style={{ flexGrow: 1, minWidth: "45%", padding: 10, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>{s.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: "800", color: s.color }}>{s.value}</Text>
          </View>
        ))}
      </View>

      <Field
        dense
        label="Dönem"
        testID="emp-puantaj-month"
        value={month}
        onChangeText={setMonth}
        placeholder="YYYY-AA"
      />

      <Row testID="emp-puantaj-view" style={{ gap: 6 }}>
        <Pressable
          testID="emp-puantaj-view-table"
          onPress={() => setView("table")}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: view === "table" ? "#fff" : colors.slate50,
            borderWidth: 1,
            borderColor: view === "table" ? colors.indigo : colors.border,
          }}
        >
          <Ionicons name="list-outline" size={14} color={view === "table" ? colors.indigo : colors.muted} />
          <Text style={{ fontWeight: "800", fontSize: 12, color: view === "table" ? colors.indigo : colors.muted }}>Tablo</Text>
        </Pressable>
        <Pressable
          testID="emp-puantaj-view-calendar"
          onPress={() => setView("calendar")}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: view === "calendar" ? "#fff" : colors.slate50,
            borderWidth: 1,
            borderColor: view === "calendar" ? colors.indigo : colors.border,
          }}
        >
          <Ionicons name="calendar-outline" size={14} color={view === "calendar" ? colors.indigo : colors.muted} />
          <Text style={{ fontWeight: "800", fontSize: 12, color: view === "calendar" ? colors.indigo : colors.muted }}>Takvim</Text>
        </Pressable>
      </Row>

      {busy && !data ? (
        <Row style={{ justifyContent: "center", paddingVertical: 16, gap: 8 }}>
          <ActivityIndicator color={colors.indigo} />
          <Muted>Yükleniyor…</Muted>
        </Row>
      ) : null}

      {view === "table" ? (
        <View testID="emp-puantaj-table" style={{ gap: 4 }}>
          {!days.length ? <Muted>Bu ay için gün satırı yok.</Muted> : null}
          {days.map((d: PuantajDay) => {
            const tone = puantajToneColors(puantajStatusTone(d.status));
            return (
              <View
                key={d.date}
                testID={`emp-puantaj-day-${d.date}`}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: tone.bg,
                  borderWidth: 1,
                  borderColor: tone.border,
                  gap: 4,
                }}
              >
                <Row style={{ justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }}>
                    {fmtDmy(d.date)} <Text style={{ color: colors.muted, fontWeight: "700" }}>{d.weekday_label}</Text>
                  </Text>
                  <DayBadge status={d.status} label={d.status_label} />
                </Row>
                {d.status === "present" ? (
                  <Text style={{ fontWeight: "700", fontSize: 12, color: colors.text }}>
                    <Text style={{ color: "#065F46" }}>{d.check_in || "—"}</Text>
                    {" → "}
                    <Text style={{ color: "#9F1239" }}>{d.check_out || "—"}</Text>
                    {d.hours ? ` · ${d.hours} sa` : ""}
                    {d.overtime_hours ? ` · +${d.overtime_hours} sa` : ""}
                  </Text>
                ) : (
                  <Muted>{d.leave_label || d.note || (d.late_minutes ? `${d.late_minutes} dk geç` : "—")}</Muted>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View testID="emp-puantaj-calendar" style={{ gap: 4 }}>
          <View style={{ flexDirection: "row" }}>
            {PUANTAJ_WEEKDAYS.map((w) => (
              <Text key={w} style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: "800", color: colors.muted, paddingVertical: 4 }}>{w}</Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((d, i) => {
              const tone = d ? puantajToneColors(puantajStatusTone(d.status)) : null;
              return (
                <View
                  key={d ? d.date : `blank-${i}`}
                  testID={d ? `emp-puantaj-cal-${d.date}` : undefined}
                  style={{
                    width: "14.28%",
                    minHeight: 52,
                    padding: 3,
                    borderRadius: 8,
                    borderWidth: d ? 1 : 0,
                    borderColor: tone?.border || "transparent",
                    backgroundColor: tone?.bg || "transparent",
                  }}
                >
                  {d ? (
                    <>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{Number(d.date.slice(8, 10))}</Text>
                      <Text style={{ fontSize: 9, fontWeight: "700", color: tone?.fg || colors.muted }} numberOfLines={2}>
                        {d.status === "present" ? `${d.check_in || "—"}→${d.check_out || "—"}` : d.status_label}
                      </Text>
                      {d.overtime_hours ? (
                        <Text style={{ fontSize: 9, fontWeight: "800", color: colors.indigo }}>+{d.overtime_hours}sa</Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View testID="emp-puantaj-leave-year" style={{ padding: 12, borderRadius: 12, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE", gap: 8 }}>
        <Text style={{ fontSize: 10, fontWeight: "800", color: colors.indigo, textTransform: "uppercase" }}>Yıllık izin dönemi</Text>
        <Text testID="emp-puantaj-leave-year-label" style={{ fontWeight: "800", color: "#312E81", fontSize: 13 }}>
          {leaveYear.year || "—"} · hak {leaveYear.annual ?? 0}g · kullanılan {leaveYear.used ?? 0}g
          {leaveYear.carry ? ` · devir ${leaveYear.carry}g` : ""} · kalan {leaveYear.remaining ?? 0}g
        </Text>
        <PrimaryButton
          title={archiveBusy ? "Arşivleniyor…" : "Yılı arşivle / devret"}
          color={colors.indigo}
          testID="emp-puantaj-leave-rollover"
          loading={archiveBusy}
          onPress={() => { void rollover(); }}
        />
        {archives.length ? (
          <View testID="emp-puantaj-leave-archives" style={{ gap: 4 }}>
            {archives.map((a) => (
              <Muted key={a.id || a.year}>{leaveYearArchiveLine(a)}</Muted>
            ))}
          </View>
        ) : (
          <Muted>Henüz arşivlenmiş yıllık dönem yok.</Muted>
        )}
      </View>
    </View>
  );
}
