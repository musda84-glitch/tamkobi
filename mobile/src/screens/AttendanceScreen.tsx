import * as Location from "expo-location";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { TimeField } from "../components/TimeField";
import { Card, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { MesaimTodayCard } from "../components/MesaimTodayCard";
import { colors } from "../theme";
import { ATTENDANCE_DAY_WATCH_MS, CHECKOUT_UNLOCK_WATCH_MS, attendanceCalendarMonth, attendanceDisputePayload, attendanceDisputeStatus, canRequestAttendanceFix, checkInBlockedHint, checkInOffsiteBlocked, earlyLeaveApproved, earlyLeavePayload, geoConfirmHint, managerTimeEditHint, mesaimPunchOpensEditor, selfAttendanceGeoMode, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock, validateAttendanceDispute, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "../utils/attendanceSelf";
import { fmtDmy } from "../utils/calendar";
import { statusTr } from "../utils/labels";
import { idOf } from "../utils/money";
import { LocationConsentCard } from "../components/LocationConsentCard";
import { locationConsentAccepted, locationConsentPayload, locationUnavailablePayload, type LocationConsent, type LocationSignal } from "../utils/locationConsent";
import { syncLocationBackground } from "../utils/locationBackgroundSync";
import { workplaceHasCoords, type Workplace } from "../utils/workplace";

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
    expected_end?: string;
    geo_confirm_request?: { status?: string; action?: string; reason?: string; proposed_time?: string; place?: string; distance_m?: number | null } | null;
  } | null;
  location?: { label?: string; radius_m?: number; kind?: string; has_coords?: boolean } | null;
  workplace?: Workplace | null;
  schedule?: { require_geo?: boolean; start?: string; end?: string; break_minutes?: number; work_days?: number[]; location_tracking?: LocationTracking };
  day_labels?: string[];
  location_tracking?: LocationTracking;
  active_location_tracking?: LocationTracking;
  records?: {
    id?: string;
    _id?: string;
    date: string;
    check_in?: string;
    check_out?: string;
    hours?: number;
    status?: string;
    employee_confirmed?: boolean;
    dispute_note?: string;
    dispute_resolved?: boolean;
    dispute_resolution?: string;
    manager_time_edit?: {
      prev_check_in?: string;
      prev_check_out?: string;
      check_in?: string;
      check_out?: string;
      pending_employee?: boolean;
    } | null;
  }[];
  summary?: { days?: number; hours?: number };
  checkout_unlocked?: boolean;
  habit?: { typical_in?: string; typical_out?: string; sample_days?: number } | null;
  habit_label?: string | null;
  location_consent?: LocationConsent | null;
  location_signal?: LocationSignal | null;
  location_last_inside?: boolean | null;
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
  const [punchEdit, setPunchEdit] = useState<"check_in" | null>(null);
  const [punchEditTime, setPunchEditTime] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [earlyTime, setEarlyTime] = useState("");
  const [intraOpen, setIntraOpen] = useState(false);
  const [intraReason, setIntraReason] = useState("");
  const [intraOut, setIntraOut] = useState("");
  const [intraReturn, setIntraReturn] = useState("");
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [disputeIn, setDisputeIn] = useState("");
  const [disputeOut, setDisputeOut] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [signal, setSignal] = useState<LocationSignal | null>(null);
  const [liveOutside, setLiveOutside] = useState<boolean | null>(null);
  const [locMissing, setLocMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const month = attendanceCalendarMonth();
      const res = await get<AttendancePayload>(client, "/personnel/attendance/me", { company_id: companyId, month });
      setData(res);
      setSignal(res.location_signal || null);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (shouldReloadAttendanceDay(data?.today_date)) load();
    }, ATTENDANCE_DAY_WATCH_MS);
    return () => clearInterval(id);
  }, [data?.today_date, load]);

  useEffect(() => {
    if (!shouldWatchCheckoutUnlock({
      earlyPending: data?.today?.early_leave_request?.status === "pending",
      checkedIn: Boolean(data?.today?.check_in),
      checkedOut: Boolean(data?.today?.check_out),
      checkoutUnlocked: data?.checkout_unlocked,
    })) return undefined;
    const t = setInterval(() => { load(); }, CHECKOUT_UNLOCK_WATCH_MS);
    return () => clearInterval(t);
  }, [client, load, data?.today?.check_in, data?.today?.check_out, data?.today?.early_leave_request?.status, data?.checkout_unlocked]);

  const reportLocation = useCallback(async (reason?: string) => {
    let c: { latitude: number; longitude: number; accuracy_m?: number | null };
    try {
      c = await coords();
    } catch (err) {
      setLocMissing(true);
      setLiveOutside(null);
      try {
        const r = await post<{ location_signal?: LocationSignal; message?: string }>(
          client,
          "/personnel/attendance/self/location-unavailable",
          locationUnavailablePayload(reason || apiErrorMessage(err, "Konum alınamadı")),
        );
        if (r.location_signal) setSignal(r.location_signal);
        if (r.message) setMessage(r.message);
      } catch {
        /* bildirim gönderilemedi */
      }
      return false;
    }
    try {
      const r = await post<{ location_signal?: LocationSignal; punched?: string; message?: string; outside?: boolean }>(client, "/personnel/attendance/self/location", {
        latitude: c.latitude,
        longitude: c.longitude,
        accuracy_m: c.accuracy_m ?? undefined,
      });
      setLocMissing(false);
      if (typeof r.outside === "boolean") setLiveOutside(r.outside);
      if (r.location_signal) setSignal(r.location_signal);
      if (r.punched) {
        if (r.message) setMessage(r.message);
        await load();
      }
      return true;
    } catch {
      return false;
    }
  }, [client, load]);

  useEffect(() => {
    // Konum takibi iptal — arka plan / aralıklı ping yok.
    void syncLocationBackground({
      consented: false,
      enabled: false,
      continuous: false,
      interval_minutes: 0,
      checkedOut: true,
    });
  }, [client]);

  const act = async (action: "check_in", time?: string) => {
    setBusy(action);
    setError(null);
    try {
      let extra: { latitude?: number; longitude?: number; accuracy_m?: number; time?: string } = {};
      if (time) extra.time = time;
      const geoMode = selfAttendanceGeoMode(action, {
        hasTarget: Boolean(data?.location || data?.workplace?.kind === "task"),
        requireGeo: data?.workplace?.kind === "task" || data?.schedule?.require_geo !== false,
        trackingEnabled: false,
      });
      if (geoMode === "required" || geoMode === "attach") {
        try {
          const c = await coords();
          extra = { ...extra, latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy_m ?? undefined };
        } catch (err) {
          await reportLocation(apiErrorMessage(err, geoMode === "required" ? "Konum izni verilmedi." : "Konum alınamadı"));
          if (geoMode === "required") throw err;
        }
      }
      const r = await post<{ message?: string }>(client, "/personnel/attendance/self", { action, ...extra });
      setMessage(r.message || "Kaydedildi.");
      setPunchEdit(null);
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

  const confirmRecord = async (recordId: string) => {
    setBusy(`confirm-${recordId}`);
    setError(null);
    try {
      await post(client, `/personnel/attendance/${recordId}/confirm`, {});
      setMessage("Puantaj saati onaylandı.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Onay kaydedilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const rejectTimeEdit = async (recordId: string) => {
    setBusy(`reject-${recordId}`);
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/attendance/${recordId}/time-edit-decision`, { decision: "reject" });
      setMessage(r?.message || "Saat düzeltmesi reddedildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Reddedilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const requestDispute = async (recordId: string) => {
    const invalid = validateAttendanceDispute(disputeNote, disputeIn, disputeOut);
    if (invalid) { setError(invalid); return; }
    setBusy(`dispute-${recordId}`);
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/attendance/${recordId}/dispute`, attendanceDisputePayload(disputeNote, disputeIn, disputeOut));
      setMessage(r?.message || "Düzeltme talebi yöneticiye iletildi.");
      setDisputeId(null);
      setDisputeNote("");
      setDisputeIn("");
      setDisputeOut("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Düzeltme talebi gönderilemedi."));
    } finally {
      setBusy(null);
    }
  };

  const acceptConsent = async () => {
    setConsentBusy(true);
    setError(null);
    try {
      const r = await post<{ message?: string; location_consent?: LocationConsent }>(client, "/personnel/me/location-consent", locationConsentPayload());
      setMessage(r.message || "Sözleşmeler kabul edildi. Personel paneli kullanıma açıldı.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Sözleşme kaydedilemedi."));
    } finally {
      setConsentBusy(false);
    }
  };

  const today = data?.today;
  const checkedIn = Boolean(today?.check_in);
  const outside = liveOutside != null
    ? liveOutside
    : data?.location_last_inside === false
      ? true
      : data?.location_last_inside === true
        ? false
        : null;
  const hasGeoTarget = workplaceHasCoords(data?.workplace) || workplaceHasCoords(data?.location);
  const checkInBlocked = checkInOffsiteBlocked({
    checkedIn,
    hasTarget: hasGeoTarget,
    outside,
    locationMissing: locMissing && outside !== false,
  });
  const checkInHint = checkInBlocked ? checkInBlockedHint({ outside, locationMissing: locMissing && outside !== false }) : "";
  const geoPendingHint = geoConfirmHint(today);
  const earlyOk = earlyLeaveApproved(today);
  const consentOk = locationConsentAccepted(data?.location_consent);
  const liveSignal = signal || data?.location_signal;

  return (
    <Screen onRefresh={load}>
      <Text
        testID="mesai-employee-name"
        style={{
          textAlign: "center",
          fontSize: 22,
          fontWeight: "800",
          color: colors.text,
          width: "100%",
        }}
      >
        {data?.employee?.full_name || "Personel kartı bağlı değilse giriş yapılamaz."}
      </Text>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      {data?.employee && !consentOk ? (
        <LocationConsentCard
          consent={data.location_consent}
          signal={liveSignal}
          onAccept={acceptConsent}
          busy={consentBusy}
          testID="mesai-consent"
        />
      ) : null}
      {!consentOk && data?.employee ? (
        <Card testID="mesai-consent-lock">
          <Muted>KVKK (K) ve konum paylaşımı (KK) sözleşmelerini kabul edince giriş / çıkış paneli açılır.</Muted>
        </Card>
      ) : null}
      {(consentOk || !data?.employee) ? (
        <MesaimTodayCard
          now={data?.now}
          todayDate={data?.today_date}
          workplace={data?.workplace}
          location={data?.location}
          requireGeo={data?.schedule?.require_geo}
          schedule={data?.schedule}
          dayLabels={data?.day_labels}
          habit={data?.habit}
          habitFallback={data?.habit_label}
          liveSignal={liveSignal}
          showSignal={consentOk}
          today={today}
          earlyOk={earlyOk}
          busy={busy}
          earlyOpen={earlyOpen}
          earlyReason={earlyReason}
          earlyTime={earlyTime}
          intraOpen={intraOpen}
          intraReason={intraReason}
          intraOut={intraOut}
          intraReturn={intraReturn}
          geoPendingHint={geoPendingHint}
          checkInBlocked={checkInBlocked}
          checkInBlockedHint={checkInHint}
          punchEdit={punchEdit}
          punchEditTime={punchEditTime}
          onPunchEditTime={setPunchEditTime}
          onPunchEditConfirm={(time) => {
            if (!punchEdit) return;
            const hm = String(time || punchEditTime || "").trim().slice(0, 5);
            if (!/^\d{1,2}:\d{2}$/.test(hm)) { setError("Saat seçin."); return; }
            act(punchEdit, hm);
          }}
          onPunchEditCancel={() => setPunchEdit(null)}
          onCheckIn={() => {
            if (checkInBlocked) { setError(checkInHint); return; }
            if (mesaimPunchOpensEditor({ action: "check_in", checkIn: today?.check_in })) {
              setPunchEdit("check_in");
              setPunchEditTime(today?.check_in || "");
              return;
            }
            act("check_in");
          }}
          onEarlyOpen={() => setEarlyOpen(true)}
          onEarlyClose={() => setEarlyOpen(false)}
          onEarlySubmit={requestEarly}
          onEarlyCancel={cancelEarly}
          onEarlyReason={setEarlyReason}
          onEarlyTime={setEarlyTime}
          onIntraOpen={() => setIntraOpen(true)}
          onIntraClose={() => setIntraOpen(false)}
          onIntraSubmit={requestIntra}
          onIntraCancel={cancelIntra}
          onIntraReason={setIntraReason}
          onIntraOut={setIntraOut}
          onIntraReturn={setIntraReturn}
        />
      ) : null}
      {consentOk ? (data?.records || []).slice(0, 14).map((r) => {
        const rid = idOf(r);
        const open = disputeId === rid;
        const status = attendanceDisputeStatus(r);
        return (
          <Card key={rid || r.date} testID={`mesai-rec-${rid || r.date}`}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", color: colors.text }}>{fmtDmy(r.date)}</Text>
                <Muted>{`${r.check_in || "--:--"} → ${r.check_out || "--:--"}`}</Muted>
                {managerTimeEditHint(r.manager_time_edit) ? <Muted testID={`mesai-rec-edit-${rid}`}>{managerTimeEditHint(r.manager_time_edit)}</Muted> : null}
                {status ? <Muted testID={`mesai-rec-status-${rid}`}>{status}{r.dispute_note && !r.dispute_resolved ? ` · ${r.dispute_note}` : ""}</Muted> : null}
              </View>
              <Text style={{ fontWeight: "800", color: colors.text }}>{r.hours ? `${r.hours} sa` : statusTr(r.status)}</Text>
            </Row>
            {open ? (
              <View testID={`mesai-rec-dispute-${rid}`} style={{ gap: 8 }}>
                <TimeField label="Doğru giriş" testID={`mesai-rec-dispute-in-${rid}`} value={disputeIn} onChangeText={setDisputeIn} optional />
                <TimeField label="Doğru çıkış" testID={`mesai-rec-dispute-note-${rid}`} value={disputeOut} onChangeText={setDisputeOut} optional />
                <Field
                  label="Ek açıklama"
                  testID={`mesai-rec-dispute-extra-${rid}`}
                  value={disputeNote}
                  onChangeText={setDisputeNote}
                  placeholder="Opsiyonel"
                />
                <PrimaryButton
                  title={busy === `dispute-${rid}` ? "Gönderiliyor…" : "Talebi gönder"}
                  onPress={() => requestDispute(rid)}
                  color={colors.warning}
                  testID={`mesai-rec-dispute-send-${rid}`}
                />
                <PrimaryButton title="Vazgeç" onPress={() => { setDisputeId(null); setDisputeNote(""); setDisputeIn(""); setDisputeOut(""); }} color={colors.secondary} testID={`mesai-rec-dispute-close-${rid}`} />
              </View>
            ) : (
              <Row style={{ gap: 4, flexWrap: "nowrap" }}>
                {!r.employee_confirmed && rid ? (
                  <PrimaryButton
                    compact
                    title={busy === `confirm-${rid}` ? "Onaylanıyor…" : "Saati onayla"}
                    onPress={() => confirmRecord(rid)}
                    color={colors.primary}
                    testID={`mesai-rec-confirm-${rid}`}
                  />
                ) : null}
                {r.manager_time_edit?.pending_employee && rid ? (
                  <PrimaryButton
                    compact
                    title={busy === `reject-${rid}` ? "Reddediliyor…" : "Reddet"}
                    onPress={() => rejectTimeEdit(rid)}
                    color={colors.danger}
                    testID={`mesai-rec-reject-${rid}`}
                  />
                ) : null}
                {canRequestAttendanceFix(r) ? (
                  <PrimaryButton
                    compact
                    title="Düzeltme talep et"
                    onPress={() => { setDisputeId(rid); setDisputeNote(""); setDisputeIn(r.check_in || ""); setDisputeOut(r.check_out || ""); }}
                    color={colors.warning}
                    testID={`mesai-rec-dispute-open-${rid}`}
                  />
                ) : null}
              </Row>
            )}
          </Card>
        );
      }) : null}
    </Screen>
  );
}
