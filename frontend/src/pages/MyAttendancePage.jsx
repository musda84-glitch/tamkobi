import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Loader2, MapPin, CheckCircle2, AlertTriangle, CalendarDays, Timer, Moon, ShieldCheck, MessageSquareWarning } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { getPos } from "../components/GeoAttendanceCard";
import { MyLeavePanel } from "../components/MyLeavePanel";

const Stat = ({ label, value, sub, tone = "slate", testId }) => (
  <div className={`rounded-2xl border p-4 bg-white ${tone === "indigo" ? "border-indigo-200" : tone === "rose" ? "border-rose-200" : "border-slate-200"}`} data-testid={testId}>
    <div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div>
    <div className={`text-xl font-bold tracking-tight ${tone === "indigo" ? "text-indigo-700" : tone === "rose" ? "text-rose-600" : "text-slate-900"}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
  </div>
);

const RecordRow = ({ r, onConfirm, onDispute }) => {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const d = new Date(r.date + "T00:00:00");
  return (
    <div className={`px-4 py-2.5 text-xs ${r.is_off_day ? "bg-amber-50/40" : ""}`} data-testid={`my-att-${r.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-slate-700 w-28">{r.date} <span className="text-slate-400">{d.toLocaleDateString("tr-TR", { weekday: "short" })}</span></span>
        {r.status === "present" ? <span className="font-mono">{r.check_in || "--:--"} → {r.check_out || "--:--"}</span> : <span className={`font-semibold ${r.status === "absent" ? "text-rose-600" : "text-amber-600"}`}>{r.status === "absent" ? "Devamsız" : "İzinli"}</span>}
        {r.status === "present" && <span className="text-slate-500">{r.hours || 0} sa</span>}
        {r.overtime_hours > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">+{r.overtime_hours} sa mesai{r.is_off_day ? " (tatil günü)" : ""}</span>}
        {r.late_minutes > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{r.late_minutes} dk geç</span>}
        {r.early_leave_minutes > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{r.early_leave_minutes} dk erken çıkış</span>}
        <span className="ml-auto flex items-center gap-2">
          {r.employee_confirmed ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Onaylandı</span>
            : <>
              {r.dispute_note && <span className="inline-flex items-center gap-1 text-rose-600 font-semibold" title={r.dispute_note}><MessageSquareWarning className="w-3.5 h-3.5" /> İtiraz edildi</span>}
              <button onClick={() => onConfirm(r)} className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700" data-testid={`my-att-confirm-${r.id}`}>{r.dispute_note ? "Yine de Onayla" : "Onayla"}</button>
              {!r.dispute_note && <button onClick={() => setOpen(!open)} className="px-2.5 py-1 border rounded-lg font-semibold hover:bg-slate-50" data-testid={`my-att-dispute-toggle-${r.id}`}>İtiraz</button>}
            </>}
        </span>
      </div>
      {open && <form onSubmit={(e) => { e.preventDefault(); onDispute(r, note); setOpen(false); }} className="mt-2 flex gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Neyi düzeltmek istiyorsunuz? (örn. çıkış 19:30 olmalı)" className="flex-1 border rounded-lg p-1.5 bg-slate-50" required data-testid={`my-att-dispute-note-${r.id}`} /><button className="px-3 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid={`my-att-dispute-send-${r.id}`}>Gönder</button></form>}
      {r.note && <div className="text-[10px] text-slate-400 mt-0.5">{r.note}</div>}
    </div>
  );
};

export default function MyAttendancePage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/personnel/attendance/me?month=${month}`, { withCredentials: true }).then((r) => setData(r.data)).catch(() => toast.error("Puantaj yüklenemedi.")), [month]);
  useEffect(() => { load(); }, [load]);
  const act = async (action) => {
    setBusy(action);
    try {
      let coords = {};
      if (data?.location && data?.schedule?.require_geo !== false) { const c = await getPos(); coords = { latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy }; }
      const r = await axios.post(`${API_URL}/personnel/attendance/self`, { action, ...coords }, { withCredentials: true });
      toast.success(r.data.message, { duration: 6000 }); load();
    } catch (err) { toast.error(err.response?.data?.detail || err.message || "İşlem başarısız."); } finally { setBusy(null); }
  };
  const confirm = async (r) => { try { await axios.post(`${API_URL}/personnel/attendance/${r.id}/confirm`, {}, { withCredentials: true }); toast.success("Kayıt onaylandı."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } };
  const dispute = async (r, note) => { try { await axios.post(`${API_URL}/personnel/attendance/${r.id}/dispute`, { note }, { withCredentials: true }); toast.success("İtirazınız yöneticiye iletildi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } };
  if (!data) return <div className="p-8 text-sm text-slate-400">Yükleniyor…</div>;
  const s = data.summary, t = data.today, sch = data.schedule;
  const workDays = sch ? sch.work_days.map((d) => data.day_labels[d]).join(", ") : "";
  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5" data-testid="my-attendance-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div><h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Clock className="w-7 h-7 text-emerald-600" /> Mesaim</h1><p className="text-xs sm:text-sm text-slate-500">{data.employee ? `${data.employee.full_name} · ${data.employee.department || ""} ${data.employee.position ? "· " + data.employee.position : ""}` : `${user?.name || ""} — kullanıcınız bir personel kartına bağlı değil`}</p></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-white border rounded-xl p-2 text-xs" data-testid="my-att-month" />
      </div>
      {!data.employee && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800" data-testid="my-att-no-employee">Giriş/çıkış yapabilmek için yöneticinizin Personel → Personel Kartı → <b>Sistem Kullanıcısı</b> bölümünden hesabınızı personel kartınıza bağlaması gerekir.</div>}
      {data.employee && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 sm:p-6 shadow-lg space-y-5" data-testid="my-att-today">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="text-center sm:text-left">
              <div className="text-5xl sm:text-4xl font-black font-mono tracking-tight" data-testid="my-att-clock">{data.now}</div>
              <div className="text-xs text-slate-300 mt-1">{new Date(data.today_date + "T00:00:00").toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}{sch.work_days.includes((new Date(data.today_date + "T00:00:00").getDay() + 6) % 7) ? "" : " · tatil günü (çalışma = fazla mesai)"}</div>
            </div>
            <div className="text-[11px] text-slate-300 flex flex-wrap justify-center sm:justify-end gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1"><Timer className="w-3.5 h-3.5 text-emerald-400" /> Mesai {sch.start}–{sch.end} · mola {sch.break_minutes} dk</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-emerald-400" /> {workDays}</span>
              {data.location ? <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-emerald-400" /> Firma konumu · {data.location.radius_m} m{sch.require_geo === false ? " (zorunlu değil)" : ""}</span> : <span className="text-amber-300">Firma konumu tanımsız — konumsuz giriş</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => act("check_in")} disabled={!!busy || !!t?.check_in} className="flex flex-col items-center justify-center gap-1.5 py-6 sm:py-5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:bg-slate-700 disabled:text-slate-300 disabled:active:scale-100 rounded-2xl font-bold transition" data-testid="my-att-checkin">
              {busy === "check_in" ? <Loader2 className="w-8 h-8 animate-spin" /> : <LogIn className="w-8 h-8" />}<span className="text-lg sm:text-base">Giriş Yap</span><span className="text-xs font-mono font-normal opacity-90" data-testid="my-att-today-in">{t?.check_in ? `Giriş ${t.check_in}` : "henüz giriş yok"}</span>
            </button>
            <button onClick={() => act("check_out")} disabled={!!busy || !t?.check_in || !!t?.check_out} className="flex flex-col items-center justify-center gap-1.5 py-6 sm:py-5 bg-rose-500 hover:bg-rose-400 active:scale-[0.98] disabled:bg-slate-700 disabled:text-slate-300 disabled:active:scale-100 rounded-2xl font-bold transition" data-testid="my-att-checkout">
              {busy === "check_out" ? <Loader2 className="w-8 h-8 animate-spin" /> : <LogOut className="w-8 h-8" />}<span className="text-lg sm:text-base">Çıkış Yap</span><span className="text-xs font-mono font-normal opacity-90" data-testid="my-att-today-out">{t?.check_out ? `Çıkış ${t.check_out}` : t?.check_in ? "çıkış bekleniyor" : "önce giriş yapın"}</span>
            </button>
          </div>
          {(t?.hours || t?.late_minutes) ? (
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
              {t?.hours ? <span className="px-2.5 py-1 rounded-lg bg-white/10">Bugün <b>{t.hours} sa</b> çalışıldı</span> : null}
              {t?.overtime_hours ? <span className="px-2.5 py-1 rounded-lg bg-indigo-500/30 text-indigo-200 font-bold">+{t.overtime_hours} sa fazla mesai</span> : null}
              {t?.late_minutes ? <span className="px-2.5 py-1 rounded-lg bg-rose-500/30 text-rose-200 font-bold">{t.late_minutes} dk geç</span> : null}
            </div>
          ) : null}
          <div className="text-[11px] text-slate-400 text-center sm:text-left">Mesai bitişinden ({sch.end}) sonraki çıkışlar ve tatil günü çalışmaları otomatik <b className="text-indigo-300">fazla mesai</b> olarak yazılır.</div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
        <Stat label="Çalışılan gün" value={s.days_present} sub={`${s.days_absent} devamsız · ${s.days_leave} izin`} testId="my-att-stat-days" />
        <Stat label="Toplam saat" value={`${s.total_hours} sa`} sub={`${s.normal_hours} sa normal`} testId="my-att-stat-hours" />
        <Stat label="Fazla mesai" value={`${s.overtime_hours} sa`} sub={s.off_day_count ? `${s.off_day_count} tatil günü çalışma` : "mesai saati dışı"} tone="indigo" testId="my-att-stat-overtime" />
        <Stat label="Geç kalma" value={s.late_count} sub={`${s.late_minutes} dk toplam`} tone={s.late_count ? "rose" : "slate"} testId="my-att-stat-late" />
        <Stat label="Onay bekleyen" value={s.unconfirmed} sub="kayıtlarınızı onaylayın" tone={s.unconfirmed ? "rose" : "slate"} testId="my-att-stat-unconfirmed" />
      </div>
      <MyLeavePanel enabled={!!data.employee} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between"><span className="font-bold text-slate-900 text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Giriş / Çıkış Kayıtlarım ({data.records.length})</span><span className="text-[11px] text-slate-400 flex items-center gap-1"><Moon className="w-3 h-3" /> Sarı satır: tatil günü</span></div>
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {data.records.length === 0 && <div className="p-8 text-center text-xs text-slate-400">Bu ay kayıt yok.</div>}
          {data.records.map((r) => <RecordRow key={r.id} r={r} onConfirm={confirm} onDispute={dispute} />)}
        </div>
      </div>
      {s.unconfirmed > 0 && <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Yönetici tarafından girilen kayıtları "Onayla" ile doğrulayın; yanlışsa "İtiraz" ile açıklama gönderin.</div>}
    </div>
  );
}
