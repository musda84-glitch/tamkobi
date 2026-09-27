import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "expo-router";
import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { del, get, post, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { useMesaimGate } from "../auth/MesaimGateContext";
import { TimeField } from "../components/TimeField";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { Card, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { MesaimHeaderTitle } from "../components/MesaimHeaderTitle";
import { MesaimTodayCard } from "../components/MesaimTodayCard";
import { colors } from "../theme";
import { ATTENDANCE_DAY_WATCH_MS, CHECKOUT_UNLOCK_WATCH_MS, attendanceCalendarMonth, attendanceDisputePayload, attendanceDisputeStatus, canRequestAttendanceFix, checkInAlreadyDone, checkInOnceHint, earlyLeaveApproved, earlyLeavePayload, geoConfirmHint, managerTimeEditHint, selfAttendanceGeoMode, shouldReloadAttendanceDay, shouldWatchCheckoutUnlock, validateAttendanceDispute, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "../utils/attendanceSelf";
import { resolveNowHm } from "../utils/clock";
import { fmtDmy, normalizeYmd } from "../utils/calendar";
import { compressPickerAsset } from "../utils/compressUploadImage";
import {
  appendUploadBlob,
  imageUploadRequest,
  pickBrowserImages,
  resolveUploadBlob,
  uploadedImageUrl,
} from "../utils/formDataFile";
import { statusTr } from "../utils/labels";
import { idOf } from "../utils/money";
import { LocationConsentCard } from "../components/LocationConsentCard";
import { locationConsentAccepted, locationConsentPayload, locationUnavailablePayload, type LocationConsent, type LocationSignal } from "../utils/locationConsent";
import { syncLocationBackground } from "../utils/locationBackgroundSync";
import { selfLeavePayload, validateSelfLeave } from "../utils/personnel";
import { mesaimGeoHeaderLine, workplaceHasCoords, type Workplace } from "../utils/workplace";

type LocationTracking = {
  enabled?: boolean;
  continuous?: boolean;
  interval_minutes?: number;
  field?: { enabled?: boolean; continuous?: boolean; interval_minutes?: number };
};

type AttendancePayload = {
  employee?: {
    full_name: string;
    photo_url?: string | null;
    id?: string;
    department?: string | null;
    position?: string | null;
  } | null;
  now?: string;
  today_date?: string;
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
    assigned_overtime_start?: string;
    assigned_overtime_end?: string;
    geo_confirm_request?: { status?: string; action?: string; reason?: string; proposed_time?: string; place?: string; distance_m?: number | null } | null;
  } | null;
  location?: { label?: string; radius_m?: number; kind?: string; has_coords?: boolean } | null;
  workplace?: Workplace | null;
  schedule?: { require_geo?: boolean; start?: string; end?: string; break_minutes?: number; work_days?: number[]; location_tracking?: LocationTracking };
  today_window?: {
    start?: string;
    end?: string;
    break_minutes?: number;
    is_work_day?: boolean;
    weekday?: number;
    weekday_label?: string;
  } | null;
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
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
}

export function AttendanceScreen() {
  const { client, companyId } = useAuth();
  const { refresh: refreshMesaimGate } = useMesaimGate();
  const navigation = useNavigation();
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [earlyTime, setEarlyTime] = useState("");
  const [intraOpen, setIntraOpen] = useState(false);
  const [intraReason, setIntraReason] = useState("");
  const [intraOut, setIntraOut] = useState("");
  const [intraReturn, setIntraReturn] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("annual");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [disputeIn, setDisputeIn] = useState("");
  const [disputeOut, setDisputeOut] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [signal, setSignal] = useState<LocationSignal | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const month = attendanceCalendarMonth();
      const res = await get<AttendancePayload>(client, "/personnel/attendance/me", { company_id: companyId, month });
      setData(res);
      setSignal(res.location_signal || null);
      setError(null);
      await refreshMesaimGate();
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj yüklenemedi."));
    }
  }, [client, companyId, refreshMesaimGate]);

  useEffect(() => { load(); }, [load]);

  useLayoutEffect(() => {
    const placeWp = (data?.workplace || data?.location || null) as Workplace | null;
    const geo = mesaimGeoHeaderLine({
      workplace: placeWp,
      location: data?.location,
      requireGeo: data?.workplace?.kind === "task" || data?.schedule?.require_geo !== false,
    });
    navigation.setOptions({
      headerTitleAlign: "left",
      headerTitle: () => (
        <MesaimHeaderTitle place={geo.place} status={geo.status} on={geo.on} />
      ),
    });
  }, [navigation, data?.workplace, data?.location, data?.schedule?.require_geo]);

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

  const reportLocationUnavailable = useCallback(async (reason?: string) => {
    try {
      const r = await post<{ location_signal?: LocationSignal; message?: string }>(
        client,
        "/personnel/attendance/self/location-unavailable",
        locationUnavailablePayload(reason || "Konum alınamadı"),
      );
      if (r.location_signal) setSignal(r.location_signal);
      if (r.message) setMessage(r.message);
    } catch {
      /* bildirim gönderilemedi */
    }
  }, [client]);

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
      const hasTarget = workplaceHasCoords(data?.workplace) || workplaceHasCoords(data?.location);
      const geoMode = selfAttendanceGeoMode(action, {
        hasTarget,
        requireGeo: data?.workplace?.kind === "task" || data?.schedule?.require_geo !== false,
      });
      if (geoMode === "required" || geoMode === "attach") {
        setMessage("Konum alınıyor…");
        try {
          const c = await coords();
          extra = { ...extra, latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy_m ?? undefined };
        } catch (err) {
          await reportLocationUnavailable(apiErrorMessage(err, geoMode === "required" ? "Konum izni verilmedi." : "Konum alınamadı"));
          if (geoMode === "required") throw err;
        }
      }
      const r = await post<{ message?: string }>(client, "/personnel/attendance/self", { action, ...extra });
      setMessage(r.message || "Kaydedildi.");
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

  const openDayLeave = () => {
    const today = String(data?.today_date || "").slice(0, 10);
    setLeaveStart((prev) => prev || today);
    setLeaveEnd((prev) => prev || today);
    setLeaveOpen(true);
  };

  const requestDayLeave = async () => {
    const start = normalizeYmd(leaveStart);
    const end = normalizeYmd(leaveEnd) || start;
    const invalid = validateSelfLeave(start, end);
    if (invalid) { setError(invalid); return; }
    setBusy("leave");
    setError(null);
    try {
      await post(client, "/personnel/leaves/self", selfLeavePayload(leaveType, start, end, leaveReason));
      setMessage("İzin talebi gönderildi.");
      setLeaveOpen(false);
      setLeaveReason("");
      setLeaveStart("");
      setLeaveEnd("");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İzin talebi gönderilemedi."));
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

  const uploadSelfPhoto = async () => {
    const eid = String(data?.employee?.id || "").trim();
    if (!eid) {
      setError("Personel kartı bulunamadı.");
      return;
    }
    setPhotoBusy(true);
    setError(null);
    try {
      let assets: { uri?: string; fileName?: string | null; mimeType?: string | null; file?: Blob }[] = [];
      if (Platform.OS === "web") {
        assets = await pickBrowserImages(undefined, false);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") {
          setError("Galeri izni verilmedi.");
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, exif: false, mediaTypes: ["images"] });
        if (res.canceled || !res.assets?.length) return;
        assets = res.assets;
      }
      if (!assets.length) return;
      const form = new FormData();
      const compact = await compressPickerAsset(assets[0]);
      const { blob, name } = await resolveUploadBlob(compact);
      appendUploadBlob(form, blob, name);
      const { path, query } = imageUploadRequest("employee", eid, companyId);
      const uploaded = await upload<unknown>(client, path, form, query);
      const url = uploadedImageUrl(uploaded);
      if (!url) throw new Error("Fotoğraf adresi dönmedi.");
      setData((prev) => prev ? {
        ...prev,
        employee: prev.employee ? { ...prev.employee, photo_url: url } : prev.employee,
      } : prev);
      setMessage("Fotoğrafınız güncellendi.");
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setPhotoBusy(false);
    }
  };

  const today = data?.today;
  const checkedIn = checkInAlreadyDone(today?.check_in);
  const checkInOnceMsg = checkInOnceHint(today?.check_in);
  const geoPendingHint = geoConfirmHint(today);
  const earlyOk = earlyLeaveApproved(today);
  const consentOk = locationConsentAccepted(data?.location_consent);
  const liveSignal = signal || data?.location_signal;
  const empRoleLine = [data?.employee?.position, data?.employee?.department].filter(Boolean).join(" · ");

  return (
    <Screen onRefresh={load}>
      <View style={{ width: "100%", gap: 8 }} testID="mesai-employee-header">
        {data?.employee ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, width: "100%" }}>
            <EmployeeAvatar
              name={data.employee.full_name}
              photoUrl={data.employee.photo_url}
              size={72}
              testID="mesai-employee-photo"
              onLongPress={photoBusy ? undefined : () => { void uploadSelfPhoto(); }}
            />
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text
                testID="mesai-employee-name"
                numberOfLines={2}
                style={{
                  textAlign: "left",
                  fontSize: 20,
                  fontWeight: "800",
                  color: colors.text,
                }}
              >
                {data.employee.full_name}
              </Text>
              {empRoleLine ? (
                <Text
                  testID="mesai-employee-role"
                  numberOfLines={2}
                  style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}
                >
                  {empRoleLine}
                </Text>
              ) : (
                <Muted testID="mesai-employee-role-empty">Bölüm / görev tanımsız</Muted>
              )}
              <Muted testID="mesai-photo-hint">Fotoğraf için basılı tutun{photoBusy ? " · yükleniyor…" : ""}</Muted>
            </View>
          </View>
        ) : (
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
            Personel kartı bağlı değilse giriş yapılamaz.
          </Text>
        )}
      </View>
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
          schedule={data?.schedule}
          todayWindow={data?.today_window}
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
          leaveOpen={leaveOpen}
          leaveType={leaveType}
          leaveStart={leaveStart}
          leaveEnd={leaveEnd}
          leaveReason={leaveReason}
          geoPendingHint={geoPendingHint}
          checkInBlocked={checkedIn}
          checkInBlockedHint={checkInOnceMsg}
          onCheckIn={() => {
            if (checkedIn) { setMessage(checkInOnceMsg); return; }
            act("check_in", resolveNowHm(data?.now));
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
          onLeaveOpen={openDayLeave}
          onLeaveClose={() => setLeaveOpen(false)}
          onLeaveSubmit={requestDayLeave}
          onLeaveType={setLeaveType}
          onLeaveStart={(d) => {
            const next = normalizeYmd(d);
            setLeaveStart(next);
            if (!leaveEnd || leaveEnd < next) setLeaveEnd(next);
          }}
          onLeaveEnd={(d) => setLeaveEnd(normalizeYmd(d))}
          onLeaveReason={setLeaveReason}
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
