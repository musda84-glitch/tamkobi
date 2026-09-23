import * as Location from "expo-location";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { TimeField } from "../components/TimeField";
import { Badge, Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import { checkoutConfirmMessage, earlyLeavePayload, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "../utils/attendanceSelf";
import { statusTr } from "../utils/labels";
import { workplaceHint, type Workplace } from "../utils/workplace";
import { yevmiyeStatusLine } from "../utils/personnel";

type LocationTracking = {
  enabled?: boolean;
  continuous?: boolean;
  interval_minutes?: number;
  field?: { enabled?: boolean; continuous?: boolean; interval_minutes?: number };
};

type AttendancePayload = {
  employee?: { full_name: string } | null;
  now?: string;
  today_date?: string;
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
  } | null;
  location?: { label?: string; radius_m?: number; kind?: string; has_coords?: boolean } | null;
  workplace?: Workplace | null;
  schedule?: { require_geo?: boolean; start?: string; end?: string; location_tracking?: LocationTracking };
  location_tracking?: LocationTracking;
  active_location_tracking?: LocationTracking;
  records?: { id?: string; date: string; check_in?: string; check_out?: string; hours?: number; status?: string }[];
  summary?: { days?: number; hours?: number };
};

async function coords() {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new Error("Konum izni verilmedi.");
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
}

export function AttendanceScreen() {
  const { client, companyId } = useAuth();
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [outConfirm, setOutConfirm] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [earlyTime, setEarlyTime] = useState("");
  const [intraOpen, setIntraOpen] = useState(false);
  const [intraReason, setIntraReason] = useState("");
  const [intraOut, setIntraOut] = useState("");
  const [intraReturn, setIntraReturn] = useState("");

  const load = useCallback(async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const res = await get<AttendancePayload>(client, "/personnel/attendance/me", { company_id: companyId, month });
      setData(res);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const tracking = data?.active_location_tracking || data?.location_tracking;
    const onDuty = Boolean(data?.today?.check_in && !data?.today?.check_out);
    const field = data?.workplace?.kind === "task";
    if (!tracking?.enabled || !onDuty || !field) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const c = await coords();
        if (cancelled) return;
        await post(client, "/personnel/attendance/self/location", {
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy_m: c.accuracy_m ?? undefined,
        });
      } catch {
        /* izin yok veya konum kapalı */
      }
    };
    ping();
    const mins = Number(tracking.interval_minutes);
    const ms = tracking.continuous || mins === 0 ? 60_000 : Math.max(1, mins) * 60_000;
    const t = setInterval(ping, ms);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client, data?.today?.check_in, data?.today?.check_out, data?.workplace?.kind, data?.active_location_tracking, data?.location_tracking]);

  const act = async (action: "check_in" | "check_out") => {
    setBusy(action);
    setError(null);
    try {
      let extra: { latitude?: number; longitude?: number; accuracy_m?: number } = {};
      const needGeo = action === "check_in"
        ? Boolean(data?.location && data?.schedule?.require_geo !== false)
        : Boolean(data?.workplace?.kind === "task" || data?.active_location_tracking?.enabled);
      if (needGeo) {
        const c = await coords();
        extra = { latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy_m ?? undefined };
      }
      const r = await post<{ message?: string }>(client, "/personnel/attendance/self", { action, ...extra });
      setMessage(r.message || "Kaydedildi.");
      if (action === "check_out") setOutConfirm(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusy(null);
    }
  };

  const requestEarly = async () => {
    const invalid = validateEarlyLeave(earlyReason, earlyTime);
    if (invalid) { setError(invalid); return; }
    setBusy("early");
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, "/personnel/attendance/early-leave-request", earlyLeavePayload(earlyReason, earlyTime));
      setMessage(r?.message || "Erken çıkış talebi gönderildi.");
      setEarlyOpen(false);
      setEarlyReason("");
      setEarlyTime("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Erken çıkış talebi gönderilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const cancelEarly = async () => {
    setBusy("early-cancel");
    setError(null);
    try {
      const r = await del<{ message?: string }>(client, "/personnel/attendance/early-leave-request");
      setMessage(r?.message || "Talep iptal edildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Talep iptal edilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const requestIntra = async () => {
    const invalid = validateIntradayLeave(intraReason, intraOut, intraReturn);
    if (invalid) { setError(invalid); return; }
    setBusy("intra");
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, "/personnel/attendance/intraday-leave-request", intradayLeavePayload(intraReason, intraOut, intraReturn));
      setMessage(r?.message || "Gün içi izin talebi gönderildi.");
      setIntraOpen(false);
      setIntraReason("");
      setIntraOut("");
      setIntraReturn("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Gün içi izin talebi gönderilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const cancelIntra = async () => {
    setBusy("intra-cancel");
    setError(null);
    try {
      const r = await del<{ message?: string }>(client, "/personnel/attendance/intraday-leave-request");
      setMessage(r?.message || "Talep iptal edildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Talep iptal edilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const today = data?.today;
  const checkedIn = Boolean(today?.check_in);
  const checkedOut = Boolean(today?.check_out);
  const early = today?.early_leave_request;
  const intra = today?.intraday_leave_request;
  const yevLine = yevmiyeStatusLine(today);

  return (
    <Screen onRefresh={load}>
      <H1>Mesaim</H1>
      <Muted>{data?.employee?.full_name || "Personel kartı bağlı değilse giriş yapılamaz."}</Muted>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      <Card>
        <Text style={{ fontSize: 42, fontWeight: "900", color: colors.text, textAlign: "center" }}>{data?.now || "--:--"}</Text>
        <Muted>{data?.today_date}</Muted>
        <Muted testID="mesai-workplace">{workplaceHint(data?.workplace || data?.location, data?.schedule?.require_geo !== false)}</Muted>
        <Row style={{ justifyContent: "center", gap: 8 }}>
          {checkedIn ? <Badge label={`Giriş ${today?.check_in}`} tone="green" /> : <Badge label="Giriş yok" />}
          {checkedOut ? <Badge label={`Çıkış ${today?.check_out}`} tone="indigo" /> : null}
          {today?.late_minutes ? <Badge label={`${today.late_minutes} dk geç`} tone="red" /> : null}
          {yevLine ? <Badge label={yevLine} tone="amber" /> : null}
        </Row>
        <View style={{ gap: 10, marginTop: 8 }}>
          <PrimaryButton title={busy === "check_in" ? "Kaydediliyor…" : "Giriş"} onPress={() => act("check_in")} disabled={checkedIn} color={colors.accent} testID="mesai-in" />
          {outConfirm && checkedIn && !checkedOut ? (
            <View testID="mesai-out-confirm" style={{ gap: 8 }}>
              <Muted testID="mesai-out-confirm-text">{checkoutConfirmMessage(today?.check_in)}</Muted>
              <PrimaryButton
                title={busy === "check_out" ? "Kaydediliyor…" : "Çıkışı onayla"}
                onPress={() => act("check_out")}
                disabled={busy === "check_out"}
                color={colors.danger}
                testID="mesai-out-confirm-yes"
              />
              <PrimaryButton title="Vazgeç" onPress={() => setOutConfirm(false)} color={colors.secondary} testID="mesai-out-cancel" />
            </View>
          ) : (
            <PrimaryButton
              title={busy === "check_out" ? "Kaydediliyor…" : "Çıkış"}
              onPress={() => setOutConfirm(true)}
              disabled={!checkedIn || checkedOut}
              testID="mesai-out"
            />
          )}
          {early?.status === "pending" ? (
            <View testID="mesai-early-pending" style={{ gap: 8 }}>
              <Muted>Erken çıkış talebi bekliyor{early.planned_time ? ` · plan ${early.planned_time}` : ""}{early.reason ? ` · ${early.reason}` : ""}</Muted>
              <PrimaryButton title={busy === "early-cancel" ? "İptal ediliyor…" : "Talebi iptal et"} onPress={cancelEarly} color={colors.danger} testID="mesai-early-cancel" />
            </View>
          ) : earlyOpen ? (
            <View testID="mesai-early-form" style={{ gap: 8 }}>
              {early?.status === "approved" || today?.early_leave_approved ? (
                <Muted testID="mesai-early-approved">Erken çıkış onaylandı — çıkış yapabilirsiniz{early?.planned_time ? ` (plan ${early.planned_time})` : ""}.</Muted>
              ) : null}
              {early?.status === "rejected" ? <Muted>Önceki talep reddedildi{early.decision_note ? `: ${early.decision_note}` : ""}.</Muted> : null}
              {!checkedIn ? <Muted>Talebi göndermeden önce giriş yapın.</Muted> : null}
              {checkedOut ? <Muted>Bugün zaten çıkış yapılmış — yeni talep gönderilemez.</Muted> : null}
              <Field label="Neden" testID="mesai-early-reason" value={earlyReason} onChangeText={setEarlyReason} placeholder="Örn: doktor randevusu" />
              <TimeField label="Planlanan saat" testID="mesai-early-time" value={earlyTime} onChangeText={setEarlyTime} optional />
              <PrimaryButton title={busy === "early" ? "Gönderiliyor…" : "Talebi gönder"} onPress={requestEarly} disabled={!checkedIn || checkedOut} color="#D97706" testID="mesai-early-submit" />
              <PrimaryButton title="Vazgeç" onPress={() => setEarlyOpen(false)} color={colors.secondary} testID="mesai-early-close" />
            </View>
          ) : (
            <PrimaryButton title="Erken çıkış talep et" onPress={() => setEarlyOpen(true)} color="#D97706" testID="mesai-early-open" />
          )}
          {intra?.status === "pending" ? (
            <View testID="mesai-intraday-pending" style={{ gap: 8 }}>
              <Muted>Gün içi izin talebi bekliyor{intra.out_time && intra.return_time ? ` · ${intra.out_time}–${intra.return_time}` : ""}{intra.reason ? ` · ${intra.reason}` : ""}</Muted>
              <PrimaryButton title={busy === "intra-cancel" ? "İptal ediliyor…" : "Talebi iptal et"} onPress={cancelIntra} color={colors.danger} testID="mesai-intraday-cancel" />
            </View>
          ) : intraOpen ? (
            <View testID="mesai-intraday-form" style={{ gap: 8 }}>
              {intra?.status === "approved" || today?.intraday_leave_approved ? (
                <Muted testID="mesai-intraday-approved">Gün içi izin onaylandı · {intra?.out_time}–{intra?.return_time}{today?.intraday_leave_minutes ? ` (${today.intraday_leave_minutes} dk)` : ""}.</Muted>
              ) : null}
              {intra?.status === "rejected" ? <Muted>Önceki talep reddedildi{intra.decision_note ? `: ${intra.decision_note}` : ""}.</Muted> : null}
              <Field label="Neden" testID="mesai-intraday-reason" value={intraReason} onChangeText={setIntraReason} placeholder="Örn: banka / doktor" />
              <TimeField label="Çıkış saati" testID="mesai-intraday-out" value={intraOut} onChangeText={setIntraOut} />
              <TimeField label="Dönüş (giriş)" testID="mesai-intraday-return" value={intraReturn} onChangeText={setIntraReturn} />
              <PrimaryButton title={busy === "intra" ? "Gönderiliyor…" : "Gün içi izin gönder"} onPress={requestIntra} color="#0284C7" testID="mesai-intraday-submit" />
              <PrimaryButton title="Vazgeç" onPress={() => setIntraOpen(false)} color={colors.secondary} testID="mesai-intraday-close" />
            </View>
          ) : intra?.status === "approved" || today?.intraday_leave_approved ? (
            <Muted testID="mesai-intraday-approved">Gün içi izin onaylandı · {intra?.out_time}–{intra?.return_time}</Muted>
          ) : (
            <PrimaryButton title="Gün ortası çıkış / giriş" onPress={() => setIntraOpen(true)} color="#0284C7" testID="mesai-intraday-open" />
          )}
        </View>
      </Card>
      {(data?.records || []).slice(0, 14).map((r) => (
        <ListRow key={r.id || r.date} title={r.date} subtitle={`${r.check_in || "--:--"} → ${r.check_out || "--:--"}`} right={r.hours ? `${r.hours} sa` : statusTr(r.status)} />
      ))}
    </Screen>
  );
}
