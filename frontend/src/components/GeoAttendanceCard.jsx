
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MapPin, LogIn, LogOut, Loader2, Crosshair, Smartphone } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { CHECKOUT_UNLOCK_WATCH_MS, earlyLeaveApproved, selfAttendanceGeoMode, selfCheckoutUnlocked, shouldWatchCheckoutUnlock } from "../utils/attendanceSelf";
import { LocationConsentCard } from "./LocationConsentCard";
import { LocationSignal } from "./LocationSignal";
import { locationConsentAccepted, locationUnavailablePayload } from "../utils/locationConsent";

export const getPos = () => new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error("Bu cihaz konum desteklemiyor.")); navigator.geolocation.getCurrentPosition((p) => res(p.coords), (e) => rej(new Error(e.code === 1 ? "Konum izni verilmedi. Tarayıcı ayarlarından konum iznini açın." : "Konum alınamadı.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); });

export const GeoAttendanceCard = ({ companyId, onChanged }) => {
  const { user } = useAuth();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [signal, setSignal] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/personnel/attendance/geo-status?company_id=${companyId}`, { withCredentials: true }).then((r) => { setSt(r.data); setSignal(r.data.location_signal || null); }).catch(() => {}), [companyId]);
  useEffect(() => { load(); }, [load]);

  const reportLocation = useCallback(async (reason) => {
    let coords;
    try {
      coords = await getPos();
    } catch (err) {
      try {
        const r = await axios.post(`${API_URL}/personnel/attendance/self/location-unavailable`, locationUnavailablePayload(reason || err?.message), { withCredentials: true });
        if (r.data.location_signal) setSignal(r.data.location_signal);
      } catch { /* ignore */ }
      return false;
    }
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/self/location`, {
        latitude: coords.latitude, longitude: coords.longitude, accuracy_m: coords.accuracy,
      }, { withCredentials: true });
      if (r.data.location_signal) setSignal(r.data.location_signal);
      if (r.data.punched) {
        if (r.data.message) toast.success(r.data.message);
        load();
        onChanged?.();
      }
      return true;
    } catch {
      return false;
    }
  }, [load, onChanged]);

  useEffect(() => {
    if (!locationConsentAccepted(st?.location_consent)) return undefined;
    reportLocation();
    if (st?.today?.check_out) return undefined;
    const id = setInterval(() => { reportLocation(); }, 60_000);
    return () => clearInterval(id);
  }, [st?.location_consent?.accepted, st?.today?.check_out, reportLocation]);
  useEffect(() => {
    const t = st?.today;
    if (!shouldWatchCheckoutUnlock({
      earlyPending: t?.early_leave_request?.status === "pending",
      checkedIn: !!t?.check_in,
      checkedOut: !!t?.check_out,
      checkoutUnlocked: st?.checkout_unlocked,
    })) return undefined;
    const id = setInterval(() => { load(); }, CHECKOUT_UNLOCK_WATCH_MS);
    return () => clearInterval(id);
  }, [load, st?.today?.check_in, st?.today?.check_out, st?.today?.early_leave_request?.status, st?.checkout_unlocked]);
  const act = async (action) => {
    setBusy(action);
    try {
      let body = { company_id: companyId, action };
      const geoMode = selfAttendanceGeoMode(action, {
        hasTarget: Boolean(st?.location || st?.workplace?.kind === "task"),
        requireGeo: true,
        trackingEnabled: true,
      });
      if (geoMode === "required") {
        try {
          const c = await getPos();
          body = { ...body, latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy };
        } catch (geoErr) {
          await reportLocation(geoErr?.message);
          throw geoErr;
        }
      } else if (geoMode === "attach") {
        try {
          const c = await getPos();
          body = { ...body, latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy };
        } catch (geoErr) {
          await reportLocation(geoErr?.message);
        }
      }
      const r = await axios.post(`${API_URL}/personnel/attendance/geo`, body, { withCredentials: true });
      toast.success(r.data.message); load(); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || err.message || "İşlem başarısız."); } finally { setBusy(null); }
  };
  const pin = async () => {
    setBusy("pin");
    try {
      const c = await getPos();
      if (!window.confirm(`Firma konumu bu noktaya sabitlensin mi? (±${Math.round(c.accuracy)} m hassasiyet, 300 m yarıçap)`)) return;
      await axios.put(`${API_URL}/companies/${companyId}/location`, { latitude: c.latitude, longitude: c.longitude, radius_m: 300 });
      toast.success("Firma konumu kaydedildi. Personel artık 300 m içinden giriş yapabilir; çıkış her konumdan yapılabilir."); load();
    } catch (err) { toast.error(err.response?.data?.detail || err.message || "Konum kaydedilemedi."); } finally { setBusy(null); }
  };
  const acceptConsent = async ({ accept_kvkk, accept_share }) => {
    setConsentBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/location-consent`, { accept_kvkk, accept_share }, { withCredentials: true });
      toast.success(r.data.message || "Sözleşmeler kabul edildi. Personel paneli kullanıma açıldı.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sözleşme kaydedilemedi.");
    } finally {
      setConsentBusy(false);
    }
  };

  const t = st?.today;
  const isAdmin = user?.role === "admin";
  const earlyOk = earlyLeaveApproved(t);
  const consentOk = !st?.employee || locationConsentAccepted(st?.location_consent);
  const liveSignal = signal || st?.location_signal;
  const checkoutOn = st?.checkout_unlocked != null
    ? Boolean(st.checkout_unlocked) && !t?.check_out
    : selfCheckoutUnlocked({ checkedIn: !!t?.check_in, checkedOut: !!t?.check_out, nowHm: st?.now, scheduleStart: st?.schedule?.start, scheduleEnd: st?.schedule?.end, expectedEnd: t?.expected_end, checkIn: t?.check_in, earlyApproved: earlyOk });
  return (
    <div className="space-y-3" data-testid="geo-attendance-wrap">
    {st?.employee && (
      <LocationConsentCard
        consent={st.location_consent}
        signal={liveSignal}
        onAccept={acceptConsent}
        busy={consentBusy}
        testId="geo-consent"
      />
    )}
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4 shadow-lg" data-testid="geo-attendance-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-bold text-sm"><Smartphone className="w-4 h-4 text-emerald-400" /> Konumla Giriş / Çıkış <span className="text-[10px] font-semibold bg-white/10 px-2 py-0.5 rounded-full">girişte 300 m</span></div>
        <div className="text-xs text-slate-300 mt-1">
          {st?.company_location || st?.location ? <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-emerald-400" /> Firma konumu tanımlı · yarıçap {(st.company_location || st.location).radius_m} m</span> : <span className="text-amber-300">Firma konumu henüz tanımlı değil.</span>}
          {st?.employee ? <span className="ml-2">· {st.employee.full_name}</span> : <span className="ml-2 text-amber-300">· Kullanıcınız bir personel kartına bağlı değil</span>}
          {st?.workplace?.kind === "task" ? <div className="mt-1 text-indigo-200" data-testid="geo-workplace">Dış görev: {st.workplace.task_title}{st.workplace.project_name ? ` · ${st.workplace.project_name}` : ""} — giriş görev yerinden</div> : null}
        </div>
        {consentOk && <div className="mt-1.5"><LocationSignal signal={liveSignal} className="text-white/90" testId="geo-signal" /></div>}
        {t && <div className="text-xs mt-1.5 flex gap-3" data-testid="geo-today"><span>Giriş: <b className="text-emerald-300">{t.check_in || "—"}</b></span><span>Çıkış: <b className="text-rose-300">{t.check_out || "—"}</b></span>{t.hours ? <span>Süre: <b>{t.hours} sa</b></span> : null}{t.overtime_hours ? <span className="text-indigo-300">+{t.overtime_hours} sa mesai</span> : null}</div>}
        <a href="/mesai" className="inline-block text-[11px] text-emerald-300 hover:underline mt-1" data-testid="geo-my-attendance-link">Personel kendi giriş/çıkış kayıtlarını Personel Giriş Çıkış Kayıtları ekranından görür →</a>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => act("check_in")} disabled={!!busy || !st?.employee || !consentOk || !!t?.check_in || (!st?.location && st?.workplace?.kind !== "task")} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 rounded-xl text-xs font-bold" data-testid="geo-checkin-btn">{busy === "check_in" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Giriş Yap</button>
        <button onClick={() => act("check_out")} disabled={!!busy || !st?.employee || !consentOk || !checkoutOn} className="flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-400 disabled:opacity-40 rounded-xl text-xs font-bold" data-testid="geo-checkout-btn">{busy === "check_out" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} {earlyOk && t && !t.check_out ? "Çıkış (onaylı erken)" : "Çıkış Yap"}</button>
        {isAdmin && <button onClick={pin} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold" title="Bulunduğunuz noktayı firma konumu olarak kaydet" data-testid="geo-pin-btn">{busy === "pin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />} {st?.location ? "Firma Konumunu Güncelle" : "Firma Konumunu Sabitle"}</button>}
      </div>
    </div>
    </div>
  );
};
