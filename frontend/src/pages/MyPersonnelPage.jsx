import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import {
  UserRound, Wallet, ClipboardList, Factory, Clock, CalendarDays,
  AlertTriangle, CheckCircle2, Circle, ExternalLink, Loader2,
} from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { StaffMessagesPanel } from "../components/StaffMessagesPanel";
import { LocationConsentCard } from "../components/LocationConsentCard";
import { AssignedDutyCard } from "../components/AssignedDutyCard";

const money = (n) => `${formatTrAmount(Number(n || 0))} ₺`;
const statusTr = {
  paid: "Ödendi", unpaid: "Ödenmedi", pending: "Bekliyor", approved: "Onaylı",
  rejected: "Red", draft: "Taslak", planned: "Planlı", ready: "Hazır",
  waiting: "Bekliyor", in_progress: "Devam", paused: "Duraklatıldı",
  present: "Var", absent: "Yok", leave: "İzin", advance: "Avans", bonus: "Prim",
};

const Stat = ({ label, value, sub, tone = "slate", testId }) => (
  <div
    className={`rounded-2xl border p-4 bg-white ${tone === "indigo" ? "border-indigo-200" : tone === "emerald" ? "border-emerald-200" : tone === "amber" ? "border-amber-200" : "border-slate-200"}`}
    data-testid={testId}
  >
    <div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div>
    <div className={`text-xl font-bold tracking-tight ${tone === "indigo" ? "text-indigo-700" : tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

const TABS = [
  { id: "ozet", label: "Özet", icon: UserRound },
  { id: "alacak", label: "Alacaklarım", icon: Wallet },
  { id: "gorevler", label: "Görevlerim", icon: ClipboardList },
  { id: "emirler", label: "İş Emirlerim", icon: Factory },
  { id: "mesai", label: "Mesaim", icon: Clock },
];

export default function MyPersonnelPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState("ozet");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceNote, setAdvanceNote] = useState("");
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API_URL}/personnel/me`, { params: { month }, withCredentials: true })
      .then((r) => setData(r.data))
      .catch(() => toast.error("Personel bilgileri yüklenemedi."))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = params.get("tab");
    if (TABS.some((x) => x.id === t)) setTab(t);
  }, [params]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-16 text-slate-400 text-sm gap-2" data-testid="my-personnel-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  const emp = data?.employee;
  const bal = data?.balance;
  const att = data?.attendance || {};
  const leave = data?.leave_balance;
  const comp = data?.compensation;
  const tasks = data?.tasks || [];
  const openTasks = tasks.filter((t) => !t.done);
  const wos = data?.work_orders || [];
  const payrolls = data?.payrolls || [];
  const bonuses = data?.bonuses || [];
  const pendingAdvance = bonuses.find((b) => b.type === "advance" && b.source === "self" && b.status === "pending");

  const submitAdvance = async (e) => {
    e?.preventDefault?.();
    const amount = Number(String(advanceAmount).replace(",", "."));
    if (!(amount > 0)) { toast.error("Avans tutarı girin."); return; }
    setAdvanceBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/bonuses/self`, { amount, note: advanceNote, period: month }, { withCredentials: true });
      toast.success(r.data?.message || "Avans talebi gönderildi.");
      setAdvanceAmount("");
      setAdvanceNote("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Avans talebi gönderilemedi.");
    } finally {
      setAdvanceBusy(false);
    }
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

  const completeTask = async (t) => {
    if (!t?.id) return;
    setTaskBusyId(t.id);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/tasks/${t.id}/complete`, {}, { withCredentials: true });
      toast.success(r.data?.message || "Görev onaylandı.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görev onaylanamadı.");
    } finally {
      setTaskBusyId(null);
    }
  };

  const cancelAdvance = async () => {
    if (!pendingAdvance?.id) return;
    setAdvanceBusy(true);
    try {
      const r = await axios.delete(`${API_URL}/personnel/bonuses/self/${pendingAdvance.id}`, { withCredentials: true });
      toast.success(r.data?.message || "Talep iptal edildi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Talep iptal edilemedi.");
    } finally {
      setAdvanceBusy(false);
    }
  };

  const AdvanceForm = (
    <form onSubmit={submitAdvance} className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3" data-testid="my-personnel-advance-form">
      <div className="text-[10px] uppercase font-semibold text-amber-700 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Avans talebi</div>
      {pendingAdvance ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="my-personnel-advance-pending">
          <span className="font-semibold text-slate-800">Bekleyen talep: {money(pendingAdvance.amount)}</span>
          {pendingAdvance.note && <span className="text-slate-500">{pendingAdvance.note}</span>}
          <button type="button" disabled={advanceBusy} onClick={cancelAdvance} className="ml-auto px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold disabled:opacity-50" data-testid="my-personnel-advance-cancel">
            {advanceBusy ? "İptal…" : "Talebi iptal et"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs">
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-600 mb-0.5">Tutar (₺)</label>
            <input required value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} placeholder="Örn: 5000" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="my-personnel-advance-amount" />
          </div>
          <div className="sm:col-span-3">
            <label className="block font-semibold text-slate-600 mb-0.5">Açıklama</label>
            <input value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} placeholder="İsteğe bağlı" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="my-personnel-advance-note" />
          </div>
          <div className="sm:col-span-1 flex items-end">
            <button type="submit" disabled={advanceBusy} className="w-full px-3 py-2 rounded-lg bg-amber-500 text-slate-900 font-bold disabled:opacity-50" data-testid="my-personnel-advance-submit">
              {advanceBusy ? "…" : "Talep et"}
            </button>
          </div>
        </div>
      )}
    </form>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5" data-testid="my-personnel-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap" data-testid="my-personnel-title">
            <UserRound className="w-7 h-7 text-emerald-600 shrink-0" /> Benim Sayfam
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            {emp
              ? `${emp.full_name}${emp.department ? ` · ${emp.department}` : ""}${emp.position ? ` · ${emp.position}` : ""}`
              : `${user?.name || ""} — hesabınız bir personel kartına bağlı değil`}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Aylık dönem<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-white border rounded-xl p-2 text-xs font-semibold text-slate-800 normal-case tracking-normal" data-testid="my-personnel-month" /></label>
      </div>
      <StaffMessagesPanel compact testId="my-personnel-messages" />
      {emp ? (
        <LocationConsentCard
          consent={data?.location_consent}
          signal={data?.location_signal}
          onAccept={acceptConsent}
          busy={consentBusy}
          testId="my-personnel-consent"
        />
      ) : null}

      {!emp && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800" data-testid="my-personnel-no-employee">
          <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Görev, iş emri ve alacaklarınızı görmek için yöneticinizin <b>Personel → Personel Kartı → Sistem Kullanıcısı</b> bölümünden hesabınızı personel kartınıza bağlaması gerekir.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" data-testid="my-personnel-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
              data-testid={`my-personnel-tab-${t.id}`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
              {t.id === "gorevler" && openTasks.length > 0 && (
                <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-md ${active ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"}`}>{openTasks.length}</span>
              )}
              {t.id === "emirler" && wos.length > 0 && (
                <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-md ${active ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"}`}>{wos.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "ozet" && emp && (
        <div className="space-y-4" data-testid="my-personnel-ozet">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Kalan alacak" value={money(bal?.remaining)} sub={`${month} dönemi`} tone="emerald" testId="my-pers-stat-balance" />
            <Stat label="Fazla mesai" value={`${att.overtime_hours || 0} sa`} sub={`${att.total_hours || 0} sa toplam`} tone="indigo" testId="my-pers-stat-ot" />
            <Stat label="Açık görev" value={openTasks.length} sub={`${tasks.length} toplam`} testId="my-pers-stat-tasks" />
            <Stat label="İş emri" value={wos.length} sub="aktif atamalar" tone="amber" testId="my-pers-stat-wo" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-1">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Ücret</div>
              <div className="text-base font-bold text-slate-900">{money(comp?.salary)}</div>
              {!!comp?.second_salary && <div className="text-slate-500">2. maaş: {money(comp.second_salary)}</div>}
              {(comp?.meal_allowance > 0 || comp?.transport_allowance > 0) && (
                <div className="text-slate-500">Yemek {money(comp.meal_allowance)} · Yol {money(comp.transport_allowance)}</div>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-1">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> İzin bakiyesi</div>
              <div className="text-base font-bold text-slate-900">{leave?.remaining ?? "—"} gün</div>
              <div className="text-slate-500">Kullanılan {leave?.used ?? 0} / {leave?.annual ?? 0} · Bekleyen {leave?.pending ?? 0}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-2">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Bu ay mesai</div>
              <div className="text-slate-600">{att.days_present || 0} gün · {att.normal_hours || 0} sa normal</div>
              <Link to="/mesai" className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline" data-testid="my-personnel-mesai-link">
                Giriş/çıkış kayıtları <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
          {AdvanceForm}
        </div>
      )}

      {tab === "alacak" && emp && (
        <div className="space-y-4" data-testid="my-personnel-alacak">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Stat label="Kalan toplam" value={money(bal?.remaining)} tone="emerald" testId="my-pers-bal-remaining" />
            <Stat label="Ödenmemiş bordro" value={money(bal?.unpaid_payroll)} testId="my-pers-bal-payroll" />
            <Stat label="Bekleyen prim" value={money(bal?.bonus_pending)} tone="indigo" testId="my-pers-bal-bonus" />
            <Stat label="Yemek alacağı" value={money(bal?.meal_due)} testId="my-pers-bal-meal" />
            <Stat label="Yol alacağı" value={money(bal?.transport_due)} testId="my-pers-bal-transport" />
            <Stat label="Avans (mahsup)" value={money(bal?.advances)} tone="amber" testId="my-pers-bal-advance" />
          </div>
          {AdvanceForm}
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b text-xs font-bold text-slate-700">Bordrolar</div>
            {payrolls.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">Bordro kaydı yok.</div>
            ) : (
              <ul className="divide-y text-xs" data-testid="my-personnel-payrolls">
                {payrolls.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" data-testid={`my-pers-payroll-${p.id}`}>
                    <span className="font-mono text-slate-700 w-24">{p.period}</span>
                    <span className="font-semibold">{money(p.final_payable ?? p.net_salary)}</span>
                    {p.overtime_pay > 0 && <span className="text-indigo-700">+{money(p.overtime_pay)} mesai ({p.overtime_hours} sa)</span>}
                    {p.second_salary > 0 && <span className="text-amber-700">+{money(p.second_salary)} 2. maaş</span>}
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${p.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                      {statusTr[p.status] || p.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b text-xs font-bold text-slate-700">Prim / Avans</div>
            {bonuses.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">Prim veya avans kaydı yok.</div>
            ) : (
              <ul className="divide-y text-xs" data-testid="my-personnel-bonuses">
                {bonuses.map((b) => (
                  <li key={b.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" data-testid={`my-pers-bonus-${b.id}`}>
                    <span className="font-semibold text-slate-700">{statusTr[b.type] || b.type || "Prim"}</span>
                    <span>{money(b.amount)}</span>
                    {b.period && <span className="font-mono text-slate-400">{b.period}</span>}
                    {b.note && <span className="text-slate-500 truncate max-w-[200px]">{b.note}</span>}
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${b.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {statusTr[b.status] || b.status || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "gorevler" && emp && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="my-personnel-tasks">
          <div className="px-4 py-3 border-b text-xs font-bold text-slate-700 flex items-center justify-between gap-2">
            <span>Proje görevlerim ({tasks.length})</span>
            <div className="flex items-center gap-2">
              <span className="font-normal text-slate-400">{openTasks.length} açık</span>
              <Link to="/atolye" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white font-bold" data-testid="my-pers-goto-atolye">
                <Factory className="w-3.5 h-3.5" /> Atölye ekranı
              </Link>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="p-6 text-xs text-slate-400 text-center">Size atanmış proje görevi yok.</div>
          ) : (
            <div className="p-3 space-y-3">
              {tasks.map((t, i) => (
                <AssignedDutyCard
                  key={t.id || i}
                  duty={t}
                  index={i}
                  testId={`my-pers-task-${i}`}
                  showAtolye
                  approveBusy={taskBusyId === t.id}
                  onApprove={() => completeTask(t)}
                  onChanged={() => load()}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "emirler" && emp && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="my-personnel-work-orders">
          <div className="px-4 py-3 border-b text-xs font-bold text-slate-700">Aktif iş emirlerim ({wos.length})</div>
          {wos.length === 0 ? (
            <div className="p-6 text-xs text-slate-400 text-center">Size atanmış açık iş emri yok.</div>
          ) : (
            <ul className="divide-y text-xs">
              {wos.map((w, i) => (
                <li key={w.id || i} className="px-4 py-3 flex flex-wrap gap-x-4 gap-y-1 items-center" data-testid={`my-pers-wo-${i}`}>
                  <span className="font-mono font-semibold text-slate-800">{w.order_code || w.id}</span>
                  <span className="text-slate-700">{w.product_name || "—"}</span>
                  {w.station && <span className="text-slate-500">{w.station}{w.step_no != null ? ` · adım ${w.step_no}` : ""}</span>}
                  {w.planned_date && <span className="text-slate-400">{w.planned_date}</span>}
                  {w.qty != null && <span className="text-slate-500">×{w.qty}</span>}
                  <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                    {statusTr[w.status] || w.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "mesai" && emp && (
        <div className="space-y-4" data-testid="my-personnel-mesai-tab">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Çalışılan gün" value={att.days_present || 0} sub={`${att.days_absent || 0} devamsız · ${att.days_leave || 0} izin`} testId="my-pers-att-days" />
            <Stat label="Toplam saat" value={`${att.total_hours || 0} sa`} sub={`${att.normal_hours || 0} sa normal`} testId="my-pers-att-hours" />
            <Stat label="Fazla mesai" value={`${att.overtime_hours || 0} sa`} tone="indigo" sub={att.off_day_count ? `${att.off_day_count} tatil günü` : "mesai dışı"} testId="my-pers-att-ot" />
            <Stat label="Geç kalma" value={att.late_count || 0} tone="amber" sub={`${att.late_minutes || 0} dk toplam`} testId="my-pers-att-late" />
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Giriş/çıkış, erken çıkış talebi ve kayıt onayı için Mesaim ekranını kullanın.</p>
            <Link to="/mesai" className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700" data-testid="my-personnel-open-mesai">
              <Clock className="w-3.5 h-3.5" /> Mesaim’e git
            </Link>
          </div>
        </div>
      )}

      {!emp && tab !== "ozet" && (
        <div className="text-xs text-slate-400 text-center py-8">Personel kartı bağlanınca bu bölüm dolacak.</div>
      )}
    </div>
  );
}
