
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Factory, Play, Pause, CheckCircle2, Clock, User, Maximize2, Minimize2, RefreshCw, MapPin, Package, KeyRound, X, Loader2 } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

const STATUS = { waiting: ["Bekliyor", "bg-slate-100 text-slate-500"], ready: ["Hazır", "bg-blue-50 text-blue-700"], in_progress: ["Devam Ediyor", "bg-amber-50 text-amber-700"], paused: ["Duraklatıldı", "bg-orange-50 text-orange-700"], done: ["Tamamlandı", "bg-emerald-50 text-emerald-700"] };

export default function ShopFloorPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [wos, setWos] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stations, setStations] = useState([]);
  const [operator, setOperator] = useState("");
  const [station, setStation] = useState(() => localStorage.getItem("nx_station") || "");
  const [pendingEmp, setPendingEmp] = useState(null);
  const [pin, setPin] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const [kiosk, setKiosk] = useState(false);
  const [finishing, setFinishing] = useState(null);
  const [fin, setFin] = useState({ produced_qty: 0, scrap_qty: 0, notes: "" });
  const [showDone, setShowDone] = useState(false);
  const [perf, setPerf] = useState(null);
  const [showPerf, setShowPerf] = useState(false);
  const [duties, setDuties] = useState([]);
  const [dutyBusyId, setDutyBusyId] = useState(null);
  const loadPerf = useCallback(() => axios.get(`${API_URL}/production/work-orders/performance?company_id=${companyId}`).then((r) => setPerf(r.data)).catch(() => {}), [companyId]);
  useEffect(() => { loadPerf(); }, [loadPerf, wos.length]);

  const load = useCallback(async () => {
    try {
      const [w, e, s, me] = await Promise.all([
        axios.get(`${API_URL}/production/work-orders?company_id=${companyId}${station ? `&station=${encodeURIComponent(station)}` : ""}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/personnel/employees?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/production/work-orders/stations?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/personnel/me`, { withCredentials: true }).catch(() => ({ data: { tasks: [] } })),
      ]);
      setWos(w.data || []); setEmployees(e.data || []); setStations(s.data || []);
      setDuties(Array.isArray(me.data?.tasks) ? me.data.tasks : []);
    } catch { /* keep last */ }
  }, [companyId, station]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { localStorage.setItem("nx_station", station); }, [station]);

  const requestOperator = (name) => {
    if (!name) { setOperator(""); setPendingEmp(null); setPin(""); setUnlockErr(""); return; }
    if (name === operator) return;
    const emp = employees.find((e) => e.full_name === name);
    if (!emp) return;
    setPendingEmp(emp); setPin(""); setUnlockErr("");
  };
  const cancelUnlock = () => { setPendingEmp(null); setPin(""); setUnlockErr(""); };
  const unlockOperator = async (e) => {
    e.preventDefault();
    if (!pendingEmp) return;
    setUnlockBusy(true); setUnlockErr("");
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/shopfloor-unlock`, { company_id: companyId, employee_id: pendingEmp.id, password: pin });
      setOperator(r.data.operator_name); setPendingEmp(null); setPin("");
      toast.success(`${r.data.operator_name} olarak giriş yapıldı.`);
    } catch (err) { const msg = err.response?.data?.detail || "Şifre doğrulanamadı."; setUnlockErr(msg); toast.error(msg); setPin(""); }
    finally { setUnlockBusy(false); }
  };

  const act = async (w, action, body) => {
    if (!operator) { toast.error("Önce operatör (personel) seçin."); return; }
    try { const r = await axios.post(`${API_URL}/production/work-orders/${w.id}/${action}`, { operator_name: operator, ...(body || {}) }); toast.success(r.data.message); setFinishing(null); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); }
  };
  const openFinish = (w) => { setFinishing(w); setFin({ produced_qty: w.planned_quantity, scrap_qty: 0, notes: "" }); };
  const active = wos.filter((w) => w.status !== "done" && w.status !== "waiting");
  const waiting = wos.filter((w) => w.status === "waiting");
  const done = wos.filter((w) => w.status === "done");
  const mine = active.filter((w) => w.operator_name === operator || w.assigned_name === operator);
  const openDuties = duties.filter((t) => !t.done);

  const approveDuty = async (t) => {
    if (!t?.id) return;
    setDutyBusyId(t.id);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/tasks/${t.id}/complete`, {}, { withCredentials: true });
      toast.success(r.data?.message || "Görev onaylandı.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görev onaylanamadı.");
    } finally {
      setDutyBusyId(null);
    }
  };

  const Card = ({ w }) => { const [l, c] = STATUS[w.status] || STATUS.waiting; return (
    <div className={`bg-white rounded-2xl border-2 p-4 space-y-3 ${w.status === "in_progress" ? "border-amber-400 shadow-lg shadow-amber-100" : w.status === "ready" ? "border-blue-200" : "border-slate-200"}`} data-testid={`wo-card-${w.order_code}-${w.step_no}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0"><div className="font-mono text-xs text-slate-400">{w.order_code} • Adım {w.step_no}/{w.step_count}</div><div className="font-bold text-slate-900 text-base leading-tight truncate">{w.step_name}</div><div className="text-sm text-slate-600 flex items-center gap-1 truncate"><Package className="w-3.5 h-3.5" /> {w.product_name}</div></div>
        <span className={`shrink-0 px-2 py-1 rounded-lg text-xs font-bold ${c}`}>{l}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {w.station}</span>
        <span className="font-bold text-slate-900 text-sm">{w.planned_quantity} {w.unit}</span>
        {w.duration_min > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Hedef {w.duration_min} dk</span>}
        {w.elapsed_min != null && <span className={`flex items-center gap-1 font-semibold ${w.duration_min && w.elapsed_min > w.duration_min ? "text-rose-600" : "text-amber-700"}`}><Clock className="w-3.5 h-3.5" /> {w.elapsed_min} dk geçti</span>}
        {(w.operator_name || w.assigned_name) && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {w.operator_name || w.assigned_name}</span>}
        {w.planned_date && <span>Plan: {w.planned_date}</span>}
      </div>
      {w.notes && <div className="text-xs bg-slate-50 rounded-lg p-2 text-slate-600">{w.notes}</div>}
      <div className="grid grid-cols-2 gap-2">
        {w.status === "ready" && <button onClick={() => act(w, "start")} className="col-span-2 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base" data-testid={`wo-start-${w.order_code}-${w.step_no}`}><Play className="w-5 h-5" /> Başla</button>}
        {w.status === "in_progress" && <><button onClick={() => act(w, "pause")} className="flex items-center justify-center gap-2 py-3 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-xl font-bold" data-testid={`wo-pause-${w.order_code}-${w.step_no}`}><Pause className="w-5 h-5" /> Duraklat</button><button onClick={() => openFinish(w)} className="flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold" data-testid={`wo-finish-${w.order_code}-${w.step_no}`}><CheckCircle2 className="w-5 h-5" /> Bitir</button></>}
        {w.status === "paused" && <><button onClick={() => act(w, "start")} className="flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white rounded-xl font-bold" data-testid={`wo-resume-${w.order_code}-${w.step_no}`}><Play className="w-5 h-5" /> Devam</button><button onClick={() => openFinish(w)} className="flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-xl font-bold"><CheckCircle2 className="w-5 h-5" /> Bitir</button></>}
        {w.status === "waiting" && <div className="col-span-2 text-center text-xs text-slate-400 py-2">Önceki adım tamamlanınca açılır</div>}
        {w.status === "done" && <div className="col-span-2 text-center text-xs text-emerald-700 py-2 font-semibold">{w.produced_qty} üretildi{w.scrap_qty ? `, ${w.scrap_qty} fire` : ""} • {w.operator_name}</div>}
      </div>
    </div>); };

  return (
    <div className={kiosk ? "fixed inset-0 z-[100] bg-slate-100 overflow-y-auto p-4 sm:p-6" : "space-y-5"} data-testid="shopfloor-page">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Factory className="w-6 h-6 text-emerald-600" /> Üretim Ekranı (Atölye)</h1><p className="text-xs sm:text-sm text-slate-500">Makine başındaki tabletten iş emirlerini görün, adımları başlatın / bitirin</p></div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={pendingEmp ? pendingEmp.full_name : operator} onChange={(e) => requestOperator(e.target.value)} className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 font-semibold min-w-[180px]" data-testid="shopfloor-operator"><option value="">Operatör seçin…</option>{employees.map((e) => <option key={e.id} value={e.full_name}>{e.full_name} — {e.position}</option>)}</select>
          <select value={station} onChange={(e) => setStation(e.target.value)} className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 font-semibold" data-testid="shopfloor-station"><option value="">Tüm istasyonlar</option>{stations.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <button onClick={load} className="p-2.5 bg-white border-2 border-slate-300 rounded-xl" title="Yenile" data-testid="shopfloor-refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setKiosk(!kiosk)} className="flex items-center gap-1 px-3 py-2.5 bg-slate-900 text-white rounded-xl font-semibold" data-testid="shopfloor-kiosk">{kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} {kiosk ? "Çık" : "Tablet Modu"}</button>
        </div>
      </div>
      {!operator && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 font-semibold" data-testid="shopfloor-no-operator">Başlamak için yukarıdan operatörü (kendinizi) seçin ve şifrenizi girin.</div>}
      <div className="grid grid-cols-3 gap-3 text-center">{[["Hazır", wos.filter((w) => w.status === "ready").length, "text-blue-600"], ["Devam Eden", wos.filter((w) => ["in_progress", "paused"].includes(w.status)).length, "text-amber-600"], ["Bugün Biten", done.filter((w) => (w.finished_at || "").startsWith(new Date().toISOString().slice(0, 10))).length, "text-emerald-600"]].map(([l, v, c]) => <div key={l} className="bg-white border rounded-2xl p-3"><div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div><div className={`text-3xl font-black ${c}`}>{v}</div></div>)}</div>
      <div className="bg-white border rounded-2xl p-3" data-testid="shopfloor-performance">
        <button onClick={() => setShowPerf(!showPerf)} className="w-full flex items-center justify-between text-sm font-bold text-slate-800" data-testid="shopfloor-perf-toggle"><span>Bugünkü Performans — operatör / istasyon ({perf?.total_done || 0} adım tamamlandı)</span><span className="text-xs text-slate-400">{showPerf ? "Gizle" : "Göster"}</span></button>
        {showPerf && perf && (
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
            {[["Operatörler", perf.operators], ["İstasyonlar", perf.stations]].map(([t, list]) => (
              <div key={t}><div className="font-semibold text-slate-500 mb-1">{t}</div>
                <table className="w-full"><thead className="text-slate-400 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Ad</th><th className="text-right py-1">Adım</th><th className="text-right py-1">Üretim</th><th className="text-right py-1">Fire %</th><th className="text-right py-1">Ort. dk</th><th className="text-right py-1">Hedef Aşımı</th></tr></thead>
                  <tbody className="divide-y">{list.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-400">Bugün tamamlanan adım yok.</td></tr>}{list.map((r) => <tr key={r.name} data-testid={`perf-row-${r.name}`}><td className="py-1 font-semibold">{r.name}</td><td className="py-1 text-right">{r.done}</td><td className="py-1 text-right font-bold">{r.produced}</td><td className={`py-1 text-right font-semibold ${r.scrap_rate > 5 ? "text-rose-600" : "text-slate-600"}`}>%{r.scrap_rate}</td><td className="py-1 text-right">{r.avg_min ?? "-"}</td><td className={`py-1 text-right ${r.over_target ? "text-rose-600 font-bold" : ""}`}>{r.over_target}</td></tr>)}</tbody></table></div>))}
          </div>
        )}
      </div>
      {duties.length > 0 && (
        <div data-testid="shopfloor-duties">
          <h2 className="text-sm font-bold text-slate-700 mb-2">Atanan Görevler ({openDuties.length} açık)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {duties.map((t, i) => (
              <div key={t.id || i} className={`bg-white rounded-2xl border-2 p-4 space-y-3 ${t.done ? "border-emerald-200 opacity-70" : "border-indigo-200"}`} data-testid={`shopfloor-duty-${t.id || i}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-base leading-tight">{t.title || "Görev"}</div>
                    <div className="text-sm text-slate-600 truncate">{t.park_name || [t.project_number, t.project_name].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-lg text-xs font-bold ${t.done ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>{t.done ? "Tamam" : "Açık"}</span>
                </div>
                {t.done ? (
                  <div className="text-xs text-emerald-700 font-semibold">Görev onaylandı.</div>
                ) : (
                  <button
                    type="button"
                    disabled={dutyBusyId === t.id}
                    onClick={() => approveDuty(t)}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base disabled:opacity-50"
                    data-testid={`shopfloor-duty-approve-${t.id || i}`}
                  >
                    <CheckCircle2 className="w-5 h-5" /> {dutyBusyId === t.id ? "Onaylanıyor…" : "Onayla"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {mine.length > 0 && <div><h2 className="text-sm font-bold text-slate-700 mb-2">Benim İşlerim ({mine.length})</h2><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{mine.map((w) => <Card key={w.id} w={w} />)}</div></div>}
      <div><h2 className="text-sm font-bold text-slate-700 mb-2">Açık İş Emirleri ({active.length})</h2>
        {active.length === 0 && <div className="bg-white border border-dashed rounded-2xl p-10 text-center text-sm text-slate-400" data-testid="shopfloor-empty">Bekleyen iş emri yok. Üretim &amp; Reçete sayfasından "Üretim Emri Ver" ile oluşturun.</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{active.filter((w) => !mine.includes(w)).map((w) => <Card key={w.id} w={w} />)}</div></div>
      {waiting.length > 0 && <div><h2 className="text-sm font-bold text-slate-500 mb-2">Sıradaki Adımlar ({waiting.length})</h2><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 opacity-70">{waiting.map((w) => <Card key={w.id} w={w} />)}</div></div>}
      <div><button onClick={() => setShowDone(!showDone)} className="text-xs font-semibold text-slate-500 hover:text-slate-900" data-testid="shopfloor-toggle-done">{showDone ? "Tamamlananları gizle" : `Tamamlananları göster (${done.length})`}</button>{showDone && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-2">{done.slice(0, 30).map((w) => <Card key={w.id} w={w} />)}</div>}</div>
      {finishing && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setFinishing(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()} data-testid="wo-finish-modal">
            <h3 className="font-bold text-slate-900 text-lg">{finishing.step_name} — Bitir</h3>
            <p className="text-sm text-slate-500">{finishing.order_code} • {finishing.product_name} • Plan {finishing.planned_quantity} {finishing.unit}</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold mb-1">Üretilen ({finishing.unit})</label><input type="number" min="0" step="any" value={fin.produced_qty} onChange={(e) => setFin({ ...fin, produced_qty: e.target.value })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center" data-testid="wo-finish-produced" /></div>
              <div><label className="block text-xs font-semibold mb-1">Fire / Hatalı</label><input type="number" min="0" step="any" value={fin.scrap_qty} onChange={(e) => setFin({ ...fin, scrap_qty: e.target.value })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center text-rose-600" data-testid="wo-finish-scrap" /></div>
            </div>
            {Number(fin.produced_qty) + Number(fin.scrap_qty || 0) > Number(finishing.planned_quantity || 0) && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-testid="wo-finish-over-hint">
                Plan üstü üretim: {finishing.planned_quantity} {finishing.unit} planlandı, siz {Number(fin.produced_qty) + Number(fin.scrap_qty || 0)} giriyorsunuz — kayıt kabul edilir.
              </p>
            )}
            <input value={fin.notes} onChange={(e) => setFin({ ...fin, notes: e.target.value })} placeholder="Not (isteğe bağlı)" className="w-full border rounded-xl p-3" data-testid="wo-finish-notes" />
            {finishing.step_no === finishing.step_count && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2">Son adım: bitirince hammaddeler düşülür, üretilen miktar stoğa eklenir. Plan üstü miktar da stoğa yazılır.</p>}
            <div className="flex gap-2"><button onClick={() => setFinishing(null)} className="flex-1 py-3 border-2 rounded-xl font-semibold">İptal</button><button onClick={() => act(finishing, "finish", { produced_qty: Number(fin.produced_qty), scrap_qty: Number(fin.scrap_qty), notes: fin.notes })} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold" data-testid="wo-finish-confirm">Tamamla</button></div>
          </div>
        </div>
      )}
      {pendingEmp && (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 flex items-center justify-center p-4" onClick={cancelUnlock}>
          <form onSubmit={unlockOperator} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4" data-testid="shopfloor-pin-modal">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2"><KeyRound className="w-5 h-5 text-emerald-600" /> Operatör şifresi</h3>
                <p className="text-sm text-slate-500 mt-1">{pendingEmp.full_name} — {pendingEmp.position}</p>
              </div>
              <button type="button" onClick={cancelUnlock} className="text-slate-400 hover:text-slate-700" data-testid="shopfloor-pin-cancel"><X className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Şifre</label>
              <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} className="w-full border-2 rounded-xl p-3 text-lg font-semibold tracking-widest" required minLength={4} data-testid="shopfloor-pin-input" />
            </div>
            {unlockErr && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="shopfloor-pin-error">{unlockErr}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={cancelUnlock} className="flex-1 py-3 border-2 rounded-xl font-semibold">Vazgeç</button>
              <button type="submit" disabled={unlockBusy || pin.length < 4} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-60" data-testid="shopfloor-pin-submit">{unlockBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Giriş</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
