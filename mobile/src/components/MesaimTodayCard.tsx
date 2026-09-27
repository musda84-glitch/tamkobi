import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { LocationSignalDot } from "./LocationSignal";
import { Card, Field, Muted, PrimaryButton } from "./kit";
import { TimeField } from "./TimeField";
import { colors, radius, typeface } from "../theme";
import {
  habitLabel,
  mesaimDateHolidaySuffix,
  mesaimEarlyArrivalLine,
  mesaimInSubtitle,
  mesaimLongDate,
  mesaimOutInfoLines,
  mesaimScheduleLine,
  mesaimWorkDaysLine,
  resolveMesaimTodayHours,
  type AttendanceHabit,
  type GeoConfirmRequest,
  type MesaimTodayWindow,
} from "../utils/attendanceSelf";
import { mesaimGeoInLabel, mesaimGeoInOn, workplaceHint, type Workplace } from "../utils/workplace";
import { yevmiyeStatusLine } from "../utils/personnel";
import type { LocationSignal } from "../utils/locationConsent";

const DARK = "#0F172A";
const DARK_META = "#CBD5E1";
const EMERALD = "#10B981";
const ROSE = "#F43F5E";
const AMBER = "#F59E0B";
const SKY = "#0EA5E9";
const SLATE_DISABLED = "#334155";

function Chip({ label, tone = "slate", testID }: { label: string; tone?: "slate" | "rose" | "amber" | "violet" | "sky"; testID?: string }) {
  const bg = {
    slate: "rgba(255,255,255,0.10)",
    rose: "rgba(244,63,94,0.30)",
    amber: "rgba(245,158,11,0.30)",
    violet: "rgba(139,92,246,0.30)",
    sky: "rgba(14,165,233,0.30)",
  }[tone];
  const fg = {
    slate: "#F8FAFC",
    rose: "#FECDD3",
    amber: "#FEF3C7",
    violet: "#EDE9FE",
    sky: "#E0F2FE",
  }[tone];
  return (
    <View testID={testID} style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function PunchTile({
  title,
  subtitle,
  color,
  disabled,
  onPress,
  icon,
  testID,
}: {
  title: string;
  subtitle: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: 118,
        backgroundColor: disabled ? SLATE_DISABLED : color,
        borderRadius: radius.lg,
        paddingVertical: 16,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity: disabled ? 0.85 : 1,
      }}
    >
      <Ionicons name={icon} size={28} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center" }}>{title}</Text>
      <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "600", textAlign: "center" }}>{subtitle}</Text>
    </Pressable>
  );
}

function Panel({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: "rgba(255,255,255,0.10)",
        borderColor: "rgba(255,255,255,0.12)",
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

export function MesaimTodayCard({
  now,
  todayDate,
  workplace,
  location,
  requireGeo,
  schedule,
  todayWindow,
  dayLabels,
  habit,
  habitFallback,
  liveSignal,
  showSignal,
  today,
  earlyOk,
  busy,
  earlyOpen,
  earlyReason,
  earlyTime,
  intraOpen,
  intraReason,
  intraOut,
  intraReturn,
  geoPendingHint,
  checkInBlocked,
  checkInBlockedHint,
  onCheckIn,
  onEarlyOpen,
  onEarlyClose,
  onEarlySubmit,
  onEarlyCancel,
  onEarlyReason,
  onEarlyTime,
  onIntraOpen,
  onIntraClose,
  onIntraSubmit,
  onIntraCancel,
  onIntraReason,
  onIntraOut,
  onIntraReturn,
}: {
  now?: string;
  todayDate?: string;
  workplace?: Workplace | null;
  location?: { label?: string; radius_m?: number; kind?: string; has_coords?: boolean } | null;
  requireGeo?: boolean;
  schedule?: { start?: string; end?: string; break_minutes?: number; work_days?: number[] } | null;
  todayWindow?: MesaimTodayWindow | null;
  dayLabels?: string[] | null;
  habit?: AttendanceHabit | null;
  habitFallback?: string | null;
  liveSignal?: LocationSignal | null;
  showSignal?: boolean;
  today?: {
    check_in?: string;
    check_out?: string;
    hours?: number;
    late_minutes?: number;
    early_arrival_minutes?: number;
    early_leave_approved?: boolean;
    early_leave_request?: { status?: string; reason?: string; planned_time?: string; decision_note?: string } | null;
    intraday_leave_approved?: boolean;
    intraday_leave_minutes?: number;
    intraday_leave_request?: { status?: string; reason?: string; out_time?: string; return_time?: string; decision_note?: string } | null;
    yevmiye_full_amount?: number;
    yevmiye_adjustment_request?: { status?: string; full_amount?: number; proposed_amount?: number; final_amount?: number } | null;
    expected_end?: string;
    scheduled_start?: string;
    scheduled_end?: string;
    assigned_overtime_hours?: number;
    geo_confirm_request?: GeoConfirmRequest | null;
  } | null;
  earlyOk?: boolean;
  busy?: string | null;
  earlyOpen?: boolean;
  earlyReason: string;
  earlyTime: string;
  intraOpen?: boolean;
  intraReason: string;
  intraOut: string;
  intraReturn: string;
  geoPendingHint?: string;
  checkInBlocked?: boolean;
  checkInBlockedHint?: string;
  onCheckIn: () => void;
  onEarlyOpen: () => void;
  onEarlyClose: () => void;
  onEarlySubmit: () => void;
  onEarlyCancel: () => void;
  onEarlyReason: (v: string) => void;
  onEarlyTime: (v: string) => void;
  onIntraOpen: () => void;
  onIntraClose: () => void;
  onIntraSubmit: () => void;
  onIntraCancel: () => void;
  onIntraReason: (v: string) => void;
  onIntraOut: (v: string) => void;
  onIntraReturn: (v: string) => void;
}) {
  const checkedIn = Boolean(today?.check_in);
  const checkedOut = Boolean(today?.check_out);
  const early = today?.early_leave_request;
  const intra = today?.intraday_leave_request;
  const hours = resolveMesaimTodayHours({ todayWindow, today, schedule });
  const scheduleLine = mesaimScheduleLine(
    hours.start && hours.end
      ? { start: hours.start, end: hours.end, break_minutes: hours.breakMinutes ?? undefined }
      : schedule,
    { label: "Bugün" },
  );
  const workDays = mesaimWorkDaysLine(schedule?.work_days, dayLabels);
  const dateLine = mesaimLongDate(todayDate);
  const holidaySuffix = mesaimDateHolidaySuffix({
    todayDate,
    isWorkDay: todayWindow?.is_work_day,
    workDays: schedule?.work_days,
  });
  const earlyArrivalLine = mesaimEarlyArrivalLine({
    checkIn: today?.check_in,
    earlyMinutes: today?.early_arrival_minutes,
    mesaiStart: hours.start,
  });
  const habitText = habitLabel(habit, habitFallback);
  const mesaiEnd = hours.end || today?.expected_end || schedule?.end || "";
  const yevLine = yevmiyeStatusLine(today);
  const geoPlace = workplace || location;
  const geoInOn = mesaimGeoInOn({ workplace: geoPlace, requireGeo });
  const geoInLabel = mesaimGeoInLabel({ workplace: geoPlace, requireGeo });
  const outInfo = mesaimOutInfoLines({
    checkIn: today?.check_in,
    checkOut: today?.check_out,
    scheduledEnd: hours.end || today?.scheduled_end || schedule?.end,
    expectedEnd: today?.expected_end || mesaiEnd,
    assignedOvertimeHours: today?.assigned_overtime_hours,
    workplace,
  });
  const inDone = Boolean(checkedIn);

  return (
    <View
      testID="mesai-today"
      style={{
        backgroundColor: DARK,
        borderRadius: radius.lg,
        padding: 20,
        gap: 16,
      }}
    >
      <View style={{ alignItems: "center", gap: 12 }}>
        <Text testID="mesai-clock" style={{ fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: -1.5, ...typeface("900") }}>
          {now || "--:--"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
          {showSignal ? <LocationSignalDot signal={liveSignal} testID="mesai-signal" onDark compact /> : null}
          {dateLine ? (
            <Text style={{ color: DARK_META, fontSize: 12, fontWeight: "600" }}>
              {dateLine}{holidaySuffix}
            </Text>
          ) : null}
        </View>

        {(scheduleLine || workDays) ? (
          <View
            testID="mesai-today-window"
            style={{
              alignSelf: "stretch",
              backgroundColor: "rgba(255,255,255,0.07)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
              borderRadius: 14,
              paddingVertical: 12,
              paddingHorizontal: 14,
              gap: 10,
            }}
          >
            {scheduleLine ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 11,
                    backgroundColor: "rgba(14,165,233,0.22)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="time-outline" size={18} color="#BAE6FD" />
                </View>
                <Text style={{ color: "#F8FAFC", fontSize: 14, fontWeight: "800", flex: 1 }} numberOfLines={2}>
                  {scheduleLine}
                </Text>
              </View>
            ) : null}
            {workDays ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} testID="mesai-work-days">
                {(schedule?.work_days || []).map((n) => {
                  const lab = (dayLabels && dayLabels[Number(n)]) || ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][Number(n)] || "";
                  if (!lab) return null;
                  return (
                    <View
                      key={`wd-${n}`}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: "rgba(255,255,255,0.10)",
                      }}
                    >
                      <Text style={{ color: "#E2E8F0", fontSize: 11, fontWeight: "700" }}>{lab}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        <View
          style={{
            alignSelf: "stretch",
            backgroundColor: workplace?.kind === "task" ? "rgba(99,102,241,0.16)" : "rgba(16,185,129,0.12)",
            borderWidth: 1,
            borderColor: workplace?.kind === "task" ? "rgba(199,210,254,0.22)" : "rgba(110,231,183,0.22)",
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                backgroundColor: workplace?.kind === "task" ? "rgba(99,102,241,0.28)" : "rgba(16,185,129,0.25)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={workplace?.kind === "task" ? "navigate-outline" : "business-outline"}
                size={18}
                color={workplace?.kind === "task" ? "#C7D2FE" : "#6EE7B7"}
              />
            </View>
            <Text
              style={{
                color: workplace?.kind === "task" ? "#C7D2FE" : "#A7F3D0",
                fontSize: 13,
                fontWeight: "700",
                flex: 1,
                lineHeight: 18,
              }}
              testID="mesai-workplace"
            >
              {workplaceHint(workplace || location, requireGeo !== false)}
            </Text>
          </View>
          <View
            testID="mesai-geo-in"
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: geoInOn ? "rgba(16,185,129,0.28)" : "rgba(244,63,94,0.28)",
            }}
          >
            <Text style={{ color: geoInOn ? "#A7F3D0" : "#FECDD3", fontSize: 12, fontWeight: "800" }}>
              {geoInLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ gap: 10 }}>
          <PunchTile
            testID="mesai-in"
            icon="log-in-outline"
            title={busy === "check_in" ? "Konum alınıyor…" : inDone ? "Giriş yapıldı" : "Giriş Yap"}
            subtitle={inDone ? mesaimInSubtitle(today?.check_in) : "basınca o anki saat yazılır"}
            color={EMERALD}
            disabled={busy === "check_in" || inDone}
            onPress={onCheckIn}
          />
          <View
            testID="mesai-out-info"
            style={{
              backgroundColor: "rgba(244,63,94,0.14)",
              borderWidth: 1,
              borderColor: "rgba(254,205,211,0.22)",
              borderRadius: radius.lg,
              paddingVertical: 16,
              paddingHorizontal: 14,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: "rgba(244,63,94,0.28)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="log-out-outline" size={24} color="#FECDD3" />
              </View>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text style={{ color: "#FECDD3", fontSize: 12, fontWeight: "800", letterSpacing: 0.4 }}>ÇIKIŞ</Text>
                <Text
                  style={{ color: "#FFF", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 }}
                  testID="mesai-today-out"
                  numberOfLines={1}
                >
                  {outInfo.headline}
                </Text>
              </View>
            </View>
            <Text style={{ color: "rgba(226,232,240,0.78)", fontSize: 12, lineHeight: 17 }} testID="mesai-out-base">
              {outInfo.baseNote}
            </Text>
            {(outInfo.scheduleLine || outInfo.fieldDutyLine) ? (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,255,255,0.10)",
                  paddingTop: 10,
                  gap: 8,
                }}
              >
                {outInfo.scheduleLine ? (
                  <View
                    testID="mesai-out-schedule"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      backgroundColor: "rgba(15,23,42,0.35)",
                      borderRadius: 10,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                    }}
                  >
                    <Ionicons name="time-outline" size={16} color="#E2E8F0" />
                    <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "700", flex: 1 }}>
                      {outInfo.scheduleLine}
                    </Text>
                  </View>
                ) : null}
                {outInfo.fieldDutyLine ? (
                  <View
                    testID="mesai-out-field"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      backgroundColor: "rgba(15,23,42,0.35)",
                      borderRadius: 10,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                    }}
                  >
                    <Ionicons name="navigate-outline" size={16} color="#E2E8F0" />
                    <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "700", flex: 1 }} numberOfLines={2}>
                      {outInfo.fieldDutyLine}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

      {earlyArrivalLine ? (
        <Text testID="mesai-early-arrival" style={{ color: "#BAE6FD", fontSize: 11, fontWeight: "700", textAlign: "center" }}>
          {earlyArrivalLine}
        </Text>
      ) : null}

      {habitText ? (
        <Text testID="mesai-habit" style={{ color: "#A7F3D0", fontSize: 11, textAlign: "center" }}>{habitText}</Text>
      ) : null}

      {inDone && checkInBlockedHint ? (
        <View testID="mesai-checkin-once" style={{ backgroundColor: "rgba(16,185,129,0.18)", borderRadius: 12, padding: 10 }}>
          <Text style={{ color: "#A7F3D0", fontSize: 12, fontWeight: "700" }}>{checkInBlockedHint}</Text>
        </View>
      ) : null}

      {geoPendingHint ? (
        <View testID="mesai-geo-confirm-pending" style={{ backgroundColor: "rgba(245,158,11,0.2)", borderRadius: 12, padding: 10 }}>
          <Text style={{ color: "#FEF3C7", fontSize: 12, fontWeight: "700" }}>{geoPendingHint}</Text>
        </View>
      ) : null}

      {(today?.hours || today?.late_minutes || yevLine || today?.intraday_leave_minutes || today?.assigned_overtime_hours) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {today?.hours ? <Chip label={`Bugün ${today.hours} sa çalışıldı`} /> : null}
          {today?.assigned_overtime_hours ? (
            <Chip
              label={`Atanan +${today.assigned_overtime_hours} sa · çıkış ${today.expected_end || mesaiEnd || "—"}`}
              tone="violet"
              testID="mesai-assigned-ot"
            />
          ) : null}
          {today?.late_minutes ? <Chip label={`${today.late_minutes} dk geç`} tone="rose" /> : null}
          {today?.intraday_leave_minutes ? <Chip label={`${today.intraday_leave_minutes} dk gün içi izin düşüldü`} tone="sky" testID="mesai-intraday-mins" /> : null}
          {yevLine ? <Chip label={yevLine} tone="amber" testID="mesai-yevmiye" /> : null}
        </View>
      ) : null}

      {!checkedOut ? (
        <Panel testID="mesai-early-leave">
          {early?.status === "pending" ? (
            <View testID="mesai-early-pending" style={{ gap: 8 }}>
              <Text style={{ color: "#FDE68A", fontSize: 12, fontWeight: "700" }}>
                Erken çıkış talebi bekliyor{early.planned_time ? ` · plan ${early.planned_time}` : ""}{early.reason ? ` · ${early.reason}` : ""}
              </Text>
              <PrimaryButton title={busy === "early-cancel" ? "İptal ediliyor…" : "Talebi iptal et"} onPress={onEarlyCancel} color={colors.danger} testID="mesai-early-cancel" />
            </View>
          ) : earlyOk && !checkedOut ? (
            <Text testID="mesai-early-approved" style={{ color: "#6EE7B7", fontSize: 12, fontWeight: "700" }}>
              Erken çıkış onaylandı — yönetici puantajdan çıkış yazar{early?.planned_time ? ` (plan ${early.planned_time})` : ""}.
            </Text>
          ) : earlyOpen ? (
            <Card testID="mesai-early-form" style={{ gap: 8, margin: 0 }}>
              {early?.status === "rejected" ? <Muted>Önceki talep reddedildi{early.decision_note ? `: ${early.decision_note}` : ""}.</Muted> : null}
              {!checkedIn ? <Muted>Talebi göndermeden önce giriş yapın.</Muted> : null}
              {checkedOut ? <Muted>Bugün zaten çıkış yapılmış — yeni talep gönderilemez.</Muted> : null}
              <Field label="Neden" testID="mesai-early-reason" value={earlyReason} onChangeText={onEarlyReason} placeholder="Örn: doktor randevusu" />
              <TimeField label="Planlanan saat" testID="mesai-early-time" value={earlyTime} onChangeText={onEarlyTime} optional />
              <PrimaryButton title={busy === "early" ? "Gönderiliyor…" : "Talebi gönder"} onPress={onEarlySubmit} disabled={!checkedIn || checkedOut} color="#D97706" testID="mesai-early-submit" />
              <PrimaryButton title="Vazgeç" onPress={onEarlyClose} color={colors.secondary} testID="mesai-early-close" />
            </Card>
          ) : (
            <Pressable testID="mesai-early-open" onPress={onEarlyOpen} style={{ backgroundColor: AMBER, borderRadius: 12, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ color: DARK, fontWeight: "800", fontSize: 14 }}>Erken çıkış talep et</Text>
            </Pressable>
          )}
        </Panel>
      ) : null}

      <Panel testID="mesai-intraday-leave">
        {intra?.status === "pending" ? (
          <View testID="mesai-intraday-pending" style={{ gap: 8 }}>
            <Text style={{ color: "#BAE6FD", fontSize: 12, fontWeight: "700" }}>
              Gün içi izin talebi bekliyor{intra.out_time && intra.return_time ? ` · ${intra.out_time}–${intra.return_time}` : ""}{intra.reason ? ` · ${intra.reason}` : ""}
            </Text>
            <PrimaryButton title={busy === "intra-cancel" ? "İptal ediliyor…" : "Talebi iptal et"} onPress={onIntraCancel} color={colors.danger} testID="mesai-intraday-cancel" />
          </View>
        ) : intraOpen ? (
          <Card testID="mesai-intraday-form" style={{ gap: 8, margin: 0 }}>
            {intra?.status === "approved" || today?.intraday_leave_approved ? (
              <Muted testID="mesai-intraday-approved">Gün içi izin onaylandı · {intra?.out_time}–{intra?.return_time}{today?.intraday_leave_minutes ? ` (${today.intraday_leave_minutes} dk)` : ""}.</Muted>
            ) : null}
            {intra?.status === "rejected" ? <Muted>Önceki talep reddedildi{intra.decision_note ? `: ${intra.decision_note}` : ""}.</Muted> : null}
            <Field label="Neden" testID="mesai-intraday-reason" value={intraReason} onChangeText={onIntraReason} placeholder="Örn: banka / doktor" />
            <TimeField label="Çıkış saati" testID="mesai-intraday-out" value={intraOut} onChangeText={onIntraOut} />
            <TimeField label="Dönüş (giriş)" testID="mesai-intraday-return" value={intraReturn} onChangeText={onIntraReturn} />
            <PrimaryButton title={busy === "intra" ? "Gönderiliyor…" : "Gün içi izin gönder"} onPress={onIntraSubmit} color={SKY} testID="mesai-intraday-submit" />
            <PrimaryButton title="Vazgeç" onPress={onIntraClose} color={colors.secondary} testID="mesai-intraday-close" />
          </Card>
        ) : intra?.status === "approved" || today?.intraday_leave_approved ? (
          <Text testID="mesai-intraday-approved" style={{ color: "#6EE7B7", fontSize: 12, fontWeight: "700" }}>
            Gün içi izin onaylandı · {intra?.out_time}–{intra?.return_time}
          </Text>
        ) : (
          <Pressable testID="mesai-intraday-open" onPress={onIntraOpen} style={{ backgroundColor: SKY, borderRadius: 12, paddingVertical: 10, alignItems: "center" }}>
            <Text style={{ color: DARK, fontWeight: "800", fontSize: 14 }}>Gün içi izin talep et</Text>
          </Pressable>
        )}
      </Panel>

      <Text testID="mesai-checkout-hint" style={{ color: "#94A3B8", fontSize: 11, textAlign: "center", lineHeight: 16 }}>
        Giriş yalnız iş yeri veya atanmış görev yeri toleransı içinde. Sürekli konum takibi yok. Dış görev talimatlarında görev yerinde bir kez varlık bildirilir. Çıkış puantaj / beklenen mesai bitişinden{mesaiEnd ? ` (${mesaiEnd})` : ""} işlenir. Erken giriş kaydı tutulur; çalışma saati kişiye özel mesai başlangıcından sayılır.
      </Text>
    </View>
  );
}
