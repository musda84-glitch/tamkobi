import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { LocationSignalDot } from "./LocationSignal";
import { Card, Field, Muted, PrimaryButton } from "./kit";
import { TimeField } from "./TimeField";
import { colors, radius, typeface } from "../theme";
import {
  checkoutConfirmMessage,
  habitLabel,
  mesaimInSubtitle,
  mesaimLongDate,
  mesaimOutSubtitle,
  mesaimPunchEditHint,
  mesaimPunchNowLabel,
  mesaimScheduleLine,
  mesaimWorkDaysLine,
  type AttendanceHabit,
  type GeoConfirmRequest,
} from "../utils/attendanceSelf";
import { mesaimGeoInLabel, mesaimGeoInOn, workplaceHint, type Workplace } from "../utils/workplace";
import { yevmiyeStatusLine } from "../utils/personnel";
import type { LocationSignal } from "../utils/locationConsent";
import { resolveNowHm } from "../utils/clock";

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
  dayLabels,
  habit,
  habitFallback,
  liveSignal,
  showSignal,
  today,
  checkoutOn,
  earlyOk,
  outConfirm,
  busy,
  earlyOpen,
  earlyReason,
  earlyTime,
  intraOpen,
  intraReason,
  intraOut,
  intraReturn,
  geoPendingHint,
  punchEdit,
  punchEditTime,
  onPunchEditTime,
  onPunchEditConfirm,
  onPunchEditCancel,
  onCheckIn,
  onCheckOutAsk,
  onCheckOutConfirm,
  onCheckOutCancel,
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
    early_leave_approved?: boolean;
    early_leave_request?: { status?: string; reason?: string; planned_time?: string; decision_note?: string } | null;
    intraday_leave_approved?: boolean;
    intraday_leave_minutes?: number;
    intraday_leave_request?: { status?: string; reason?: string; out_time?: string; return_time?: string; decision_note?: string } | null;
    yevmiye_full_amount?: number;
    yevmiye_adjustment_request?: { status?: string; full_amount?: number; proposed_amount?: number; final_amount?: number } | null;
    expected_end?: string;
    geo_confirm_request?: GeoConfirmRequest | null;
  } | null;
  checkoutOn?: boolean;
  earlyOk?: boolean;
  outConfirm?: boolean;
  busy?: string | null;
  earlyOpen?: boolean;
  earlyReason: string;
  earlyTime: string;
  intraOpen?: boolean;
  intraReason: string;
  intraOut: string;
  intraReturn: string;
  geoPendingHint?: string;
  punchEdit?: "check_in" | "check_out" | null;
  punchEditTime?: string;
  onPunchEditTime?: (v: string) => void;
  onPunchEditConfirm?: (time?: string) => void;
  onPunchEditCancel?: () => void;
  onCheckIn: () => void;
  onCheckOutAsk: () => void;
  onCheckOutConfirm: () => void;
  onCheckOutCancel: () => void;
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
  const scheduleLine = mesaimScheduleLine(schedule);
  const workDays = mesaimWorkDaysLine(schedule?.work_days, dayLabels);
  const dateLine = mesaimLongDate(todayDate);
  const yevLine = yevmiyeStatusLine(today);
  const geoPlace = workplace || location;
  const geoInOn = mesaimGeoInOn({ workplace: geoPlace, requireGeo });
  const geoInLabel = mesaimGeoInLabel({ workplace: geoPlace, requireGeo });

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
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text testID="mesai-clock" style={{ fontSize: 44, fontWeight: "900", color: "#fff", letterSpacing: -1, ...typeface("900") }}>
          {now || "--:--"}
        </Text>
        {showSignal ? <LocationSignalDot signal={liveSignal} testID="mesai-signal" onDark /> : null}
        {dateLine ? <Text style={{ color: DARK_META, fontSize: 12 }}>{dateLine}</Text> : null}
        {scheduleLine ? (
          <Text style={{ color: DARK_META, fontSize: 11, fontWeight: "600" }} testID="mesai-schedule">
            {scheduleLine}{workDays ? ` · ${workDays}` : ""}
          </Text>
        ) : null}
        <Text style={{ color: workplace?.kind === "task" ? "#C7D2FE" : "#6EE7B7", fontSize: 12, fontWeight: "600", textAlign: "center" }} testID="mesai-workplace">
          {workplaceHint(workplace || location, requireGeo !== false)}
        </Text>
        <View
          testID="mesai-geo-in"
          style={{
            marginTop: 2,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: geoInOn ? "rgba(16,185,129,0.22)" : "rgba(244,63,94,0.22)",
          }}
        >
          <Text style={{ color: geoInOn ? "#6EE7B7" : "#FECDD3", fontSize: 12, fontWeight: "800" }}>
            {geoInLabel}
          </Text>
        </View>
      </View>

      {punchEdit ? (
        <View testID="mesai-punch-edit" style={{ gap: 8 }}>
          <TimeField
            key={punchEdit}
            label={punchEdit === "check_out" ? "Çıkış saati" : "Giriş saati"}
            testID="mesai-punch-edit-time"
            value={punchEditTime || ""}
            autoOpen
            nowLabel={mesaimPunchNowLabel(punchEdit)}
            nowKind={punchEdit}
            nowValue={now}
            onNow={(hm) => {
              onPunchEditTime?.(hm);
              onPunchEditConfirm?.(hm);
            }}
            onChangeText={(v) => onPunchEditTime?.(v)}
          />
          <Text style={{ color: "#FDE68A", fontSize: 12, fontWeight: "600" }}>{mesaimPunchEditHint(punchEdit)}</Text>
          <PrimaryButton
            title={mesaimPunchNowLabel(punchEdit)}
            onPress={() => {
              const hm = resolveNowHm(now);
              onPunchEditTime?.(hm);
              onPunchEditConfirm?.(hm);
            }}
            color={punchEdit === "check_out" ? ROSE : colors.indigo}
            testID="mesai-punch-edit-now"
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton
              title={busy === punchEdit ? "Gönderiliyor…" : "Onayla"}
              onPress={() => onPunchEditConfirm?.()}
              color={punchEdit === "check_out" ? ROSE : EMERALD}
              testID="mesai-punch-edit-yes"
            />
            <PrimaryButton title="Vazgeç" onPress={() => onPunchEditCancel?.()} color={colors.secondary} testID="mesai-punch-edit-no" />
          </View>
        </View>
      ) : (
      <View style={{ flexDirection: "row", gap: 10 }}>
        <PunchTile
          testID="mesai-in"
          icon="log-in-outline"
          title={busy === "check_in" ? "Kaydediliyor…" : "Giriş Yap"}
          subtitle={mesaimInSubtitle(today?.check_in)}
          color={EMERALD}
          disabled={busy === "check_in"}
          onPress={onCheckIn}
        />
        {outConfirm && (checkedIn || checkoutOn) ? (
          <View testID="mesai-out-confirm" style={{ flex: 1, gap: 8, justifyContent: "center" }}>
            <Text testID="mesai-out-confirm-text" style={{ color: "#FDE68A", fontSize: 11, fontWeight: "600" }}>
              {checkoutConfirmMessage(today?.check_in)}
            </Text>
            <PunchTile
              testID="mesai-out-confirm-yes"
              icon="log-out-outline"
              title={busy === "check_out" ? "Kaydediliyor…" : "Çıkışı onayla"}
              subtitle={mesaimOutSubtitle({ checkIn: today?.check_in, checkOut: today?.check_out, confirming: true })}
              color={AMBER}
              disabled={busy === "check_out"}
              onPress={onCheckOutConfirm}
            />
            <Pressable testID="mesai-out-cancel" onPress={onCheckOutCancel} style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ color: "#E2E8F0", fontWeight: "700", fontSize: 12 }}>Vazgeç</Text>
            </Pressable>
          </View>
        ) : (
          <PunchTile
            testID="mesai-out"
            icon="log-out-outline"
            title={busy === "check_out" ? "Kaydediliyor…" : (earlyOk && !checkedOut ? "Çıkış (onaylı erken)" : "Çıkış Yap")}
            subtitle={mesaimOutSubtitle({ checkIn: today?.check_in, checkOut: today?.check_out })}
            color={earlyOk && !checkedOut ? ROSE : ROSE}
            disabled={busy === "check_out"}
            onPress={onCheckOutAsk}
          />
        )}
      </View>
      )}

      {geoPendingHint ? (
        <View testID="mesai-geo-confirm-pending" style={{ backgroundColor: "rgba(245,158,11,0.2)", borderRadius: 12, padding: 10 }}>
          <Text style={{ color: "#FEF3C7", fontSize: 12, fontWeight: "700" }}>{geoPendingHint}</Text>
        </View>
      ) : null}

      {(today?.hours || today?.late_minutes || yevLine || today?.intraday_leave_minutes) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {today?.hours ? <Chip label={`Bugün ${today.hours} sa çalışıldı`} /> : null}
          {today?.late_minutes ? <Chip label={`${today.late_minutes} dk geç`} tone="rose" /> : null}
          {today?.intraday_leave_minutes ? <Chip label={`${today.intraday_leave_minutes} dk gün içi izin düşüldü`} tone="sky" testID="mesai-intraday-mins" /> : null}
          {yevLine ? <Chip label={yevLine} tone="amber" testID="mesai-yevmiye" /> : null}
        </View>
      ) : null}

      {habitLabel(habit, habitFallback) ? (
        <Text testID="mesai-habit" style={{ color: "#A7F3D0", fontSize: 11, textAlign: "center" }}>{habitLabel(habit, habitFallback)}</Text>
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
              Erken çıkış onaylandı — çıkış butonu açık. Saat ve konum çıkışa basınca kaydedilir{early?.planned_time ? ` (plan ${early.planned_time})` : ""}.
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
        Giriş iş yeri / görev yakınından; konum açıksa otomatik de yazılır. Çıkış her zaman açık. Konum kapalı veya iş yerinde değilken yönetici teyidi gerekir.
      </Text>
    </View>
  );
}
