import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, User, FileText, Wallet, CalendarDays, Clock, KeyRound, Upload, Trash2, ExternalLink, Loader2, Mail, Banknote, Receipt, ClipboardList, UserMinus, UtensilsCrossed, Bus } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { EmployeeCompensationForm } from "./WorkScheduleSettings";
import { QuickPayModal } from "./QuickPayModal";
import { EmployeeAssignTaskModal } from "./EmployeeAssignTaskModal";
import { EmployeeLedgerModal } from "./EmployeeLedgerModal";
import { EmployeeYevmiyeModal } from "./EmployeeYevmiyeModal";
import { empStatusLabel, formatTrDate, performanceTone, remainingTone } from "../utils/employeeCardSummary";
import { formatTrAmount } from "../utils/money";
import { employeePayActionTitle, isDailyWage, monthlyLoad, payrollWageLine, periodWage } from "../utils/personnelWage";
import { workplaceHint, workplaceShort } from "../utils/workplace";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const TABS = [["summary", "Özet", User], ["docs", "Belgeler", FileText], ["salary", "Ödemeler", Wallet], ["pay", "Ücret & Mesai", Banknote], ["leaves", "İzinler", CalendarDays], ["attendance", "Puantaj", Clock], ["user", "Sistem Kullanıcısı", KeyRound]];
const LEAVE = { annual: "Yıllık", sick: "Hastalık", unpaid: "Ücretsiz", other: "Diğer" };
const ST = { pending: ["Bekliyor", "bg-amber-100 text-amber-700"], approved: ["Onaylı", "bg-emerald-100 text-emerald-700"], rejected: ["Red", "bg-rose-100 text-rose-700"], paid: ["Ödendi", "bg-emerald-100 text-emerald-700"], unpaid: ["Ödenmedi", "bg-slate-100 text-slate-600"] };
const TONE = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700", slate: "text-slate-900" };
const BAR = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" };
const Badge = ({ s }) => { const [l, c] = ST[s] || [s, "bg-slate-100 text-slate-600"]; return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c}`}>{l}</span>; };
const Stat = ({ label, value, sub, testid, valueClass }) => <div className="bg-slate-50 rounded-xl p-3"><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className={`text-sm font-bold ${valueClass || "text-slate-900"}`} data-testid={testid}>{value}</div>{sub && <div className="text-[10px] text-slate-500">{sub}</div>}</div>;
const PerfBar = ({ label, pct, sub, testid }) => {
  const tone = performanceTone(pct);
  return (
    <div className="space-y-1" data-testid={testid}>
      <div className="flex justify-between gap-2"><span className="font-semibold text-slate-600">{label}</span><span className={`font-bold ${TONE[tone]}`}>%{pct ?? 0}</span></div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-1.5 rounded-full ${BAR[tone]}`} style={{ width: `${Math.max(0, Math.min(100, Number(pct) || 0))}%` }} /></div>
      {sub ? <div className="text-[10px] text-slate-400">{sub}</div> : null}
    </div>
  );
};

const Docs = ({ card, companyId, reload }) => {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      const compressed = file.type?.startsWith("image/") ? await compressImageFile(file) : file;
      fd.append("file", compressed);
      await axios.post(`${API_URL}/files/upload?entity=employee&entity_id=${card.employee.id}&company_id=${companyId}`, fd);
      toast.success("Belge yüklendi.");
      reload();
    }
    catch (err) { toast.error(err.response?.data?.detail || "Yüklenemedi."); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const del = async (d) => { if (!window.confirm("Belge silinsin mi?")) return; await axios.delete(`${API_URL}/files/${d.id}`); reload(); };
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 border-2 border-dashed rounded-xl p-4 cursor-pointer hover:bg-slate-50 text-xs text-slate-600" data-testid="emp-doc-upload">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-indigo-600" />} Sözleşme, kimlik, diploma, SGK belgesi… (PDF/JPG/PNG, max 10 MB)
        <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={upload} data-testid="emp-doc-file" />
      </label>
      {card.documents.length === 0 ? <div className="text-xs text-slate-400 text-center py-4">Belge yok.</div> : card.documents.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-xs border rounded-lg px-3 py-2" data-testid={`emp-doc-${d.id}`}>
          <FileText className="w-4 h-4 text-slate-400" /><span className="font-semibold text-slate-800 truncate">{d.original_filename}</span><span className="text-slate-400">{(d.size / 1024).toFixed(0)} KB · {new Date(d.created_at).toLocaleDateString("tr-TR")}</span>
          <a href={resolveImageUrl(d.url)} target="_blank" rel="noreferrer" className="ml-auto p-1 rounded hover:bg-slate-100" title="Aç"><ExternalLink className="w-3.5 h-3.5" /></a>
          <button onClick={() => del(d)} className="p-1 rounded hover:bg-rose-50 text-rose-600" data-testid={`emp-doc-del-${d.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
};

const UserTab = ({ card, reload }) => {
  const { user: me } = useAuth();
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({ email: card.employee.email || "", role: "sales", password: "", mode: "invite" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/roles?company_id=${card.employee.company_id}`).then((r) => setRoles(r.data.roles)).catch(() => {}); }, [card.employee.company_id]);
  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/employees/${card.employee.id}/create-user`, { email: form.email, role: form.role, password: form.mode === "password" ? form.password : undefined, base_url: window.location.origin, invited_by: me?.id });
      toast.success(r.data.message); reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Oluşturulamadı."); } finally { setBusy(false); }
  };
  if (card.user) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-1" data-testid="emp-user-linked">
      <div className="font-bold text-emerald-800 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Sistem kullanıcısı bağlı</div>
      <div><b>E-posta:</b> {card.user.email}</div><div><b>Rol:</b> {card.user.role}</div><div><b>Durum:</b> {card.user.is_active ? "Aktif" : "Pasif"}</div><div><b>Son giriş:</b> {card.user.last_login_at ? new Date(card.user.last_login_at).toLocaleString("tr-TR") : "-"}</div>
      <div className="text-slate-500 pt-1">Rol/şifre değişikliği için Firma Ayarları → Kullanıcılar & Roller.</div>
    </div>
  );
  return (
    <form onSubmit={create} className="space-y-3 text-xs" data-testid="emp-create-user-form">
      {card.pending_invite && <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">Bekleyen davet var: {card.pending_invite.email} — <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(card.pending_invite.link); toast.success("Link kopyalandı."); } catch { window.prompt("Davet linki:", card.pending_invite.link); } }} className="underline">linki kopyala</button></div>}
      <div><label className="block font-semibold mb-1">E-posta (giriş adı)</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-email" /></div>
      <div><label className="block font-semibold mb-1">Rol</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-role">{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></div>
      <div className="flex gap-2">{[["invite", "E-posta ile davet gönder"], ["password", "Şifreyi ben belirleyeyim"]].map(([k, l]) => <button type="button" key={k} onClick={() => setForm({ ...form, mode: k })} className={`flex-1 border rounded-lg p-2 font-semibold ${form.mode === k ? "bg-slate-900 text-white" : "bg-white"}`} data-testid={`emp-user-mode-${k}`}>{l}</button>)}</div>
      {form.mode === "password" && <div><label className="block font-semibold mb-1">Şifre (en az 6)</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-password" /></div>}
      <button disabled={busy} className="w-full py-2 bg-emerald-600 text-white rounded-lg font-bold flex items-center justify-center gap-1.5" data-testid="emp-user-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : form.mode === "invite" ? <Mail className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />} {form.mode === "invite" ? "Davet Gönder" : "Kullanıcıyı Oluştur"}</button>
    </form>
  );
};

export const EmployeeCardModal = ({ employee, companyId, accounts: accountsProp, onClose, onChanged }) => {
  const [tab, setTab] = useState("summary");
  const [card, setCard] = useState(null);
  const id = employee.id || employee._id;
  const [schedule, setSchedule] = useState(null);
  const [accounts, setAccounts] = useState(accountsProp || []);
  const [quickPay, setQuickPay] = useState(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [yevmiyeOpen, setYevmiyeOpen] = useState(null);
  const [payItem, setPayItem] = useState(null);
  const [payAccountId, setPayAccountId] = useState("");
  const [busyPay, setBusyPay] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [termOk, setTermOk] = useState(false);
  const [termDate, setTermDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busyTerm, setBusyTerm] = useState(false);
  useEscape(() => {
    if (quickPay) return;
    if (termOpen) { setTermOpen(false); setTermOk(false); return; }
    if (taskOpen) { setTaskOpen(false); return; }
    if (ledgerOpen) { setLedgerOpen(false); return; }
    if (yevmiyeOpen) { setYevmiyeOpen(null); return; }
    if (payItem) { setPayItem(null); return; }
    onClose();
  });
  const reload = useCallback(() => axios.get(`${API_URL}/personnel/employees/${id}/card`).then((r) => setCard(r.data)).catch(() => toast.error("Personel kartı yüklenemedi.")), [id]);
  useEffect(() => { reload(); axios.get(`${API_URL}/companies/${companyId}/work-schedule`).then((r) => setSchedule(r.data.schedule)).catch(() => {}); }, [reload, companyId]);
  useEffect(() => {
    if (accountsProp?.length) { setAccounts(accountsProp); return; }
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => setAccounts(r.data)).catch(() => {});
  }, [accountsProp, companyId]);
  useEffect(() => { if (!payAccountId && accounts[0]) setPayAccountId(accounts[0].id || accounts[0]._id); }, [accounts, payAccountId]);
  const e = card?.employee || employee;
  const payStub = () => ({
    employee_id: e.id || e._id,
    employee_name: e.full_name,
    period: card?.payrolls?.[0]?.period || new Date().toISOString().slice(0, 7),
  });
  const afterMoney = () => { reload(); onChanged?.(); };
  const openSalaryPay = async () => {
    let item = (card?.payrolls || []).find((p) => p.status !== "paid");
    if (!item) {
      setBusyPay(true);
      try {
        const period = new Date().toISOString().slice(0, 7);
        await axios.post(`${API_URL}/personnel/generate-payroll`, { company_id: companyId, period });
        const r = await axios.get(`${API_URL}/personnel/employees/${id}/card`);
        setCard(r.data);
        item = (r.data.payrolls || []).find((p) => p.status !== "paid");
        if (!item) { toast.success("Bu dönemin maaşı zaten ödenmiş."); return; }
      } catch (err) {
        toast.error(err.response?.data?.detail || "Bordro hazırlanamadı.");
        return;
      } finally { setBusyPay(false); }
    }
    const emp = card?.employee || employee;
    if (String(emp?.sgk_number || "").trim()) {
      const bank = (accounts || []).find((a) => String(a.type || "").toLowerCase() === "bank" && !a.is_integrated);
      setPayAccountId(bank ? (bank.id || bank._id) : "");
    }
    setPayItem(item);
  };
  const confirmSalaryPay = async () => {
    if (!payItem) return;
    const emp = card?.employee || employee;
    if (String(emp?.sgk_number || "").trim()) {
      if (!payAccountId || String(payAccountId).startsWith("partner:")) {
        toast.error("SGK’lı personelin maaşı yalnız banka hesabından ödenir.");
        return;
      }
      if (!String(emp.iban || "").trim()) {
        toast.error("SGK’lı personel için önce personel kartına IBAN girin.");
        return;
      }
    }
    setBusyPay(true);
    try {
      const res = await axios.post(`${API_URL}/personnel/payrolls/${payItem.id || payItem._id}/pay`, { ...splitPaymentTarget(payAccountId) });
      toast.success(res.data.message);
      setPayItem(null);
      afterMoney();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Maaş ödemesi gerçekleştirilemedi.");
    } finally { setBusyPay(false); }
  };
  const confirmTerminate = async () => {
    if (!termOk) return;
    setBusyTerm(true);
    try {
      const res = await axios.post(`${API_URL}/personnel/employees/${id}/terminate`, { confirm: true, end_date: termDate });
      toast.success(res.data.message || "Personel işten çıkarıldı.");
      setTermOpen(false);
      setTermOk(false);
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşten çıkarılamadı.");
    } finally { setBusyTerm(false); }
  };
  const btn = "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap w-full inline-flex items-center justify-center";
  const remaining = Number(card?.balance?.remaining) || 0;
  const ot = card?.overtime || {};
  const perf = card?.performance || {};
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={(ev) => ev.stopPropagation()} data-testid="employee-card-modal">
        <div className="p-5 border-b space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <label className="relative w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shrink-0 overflow-hidden cursor-pointer" title="Fotoğraf yükle" data-testid="emp-card-photo">
              {e.photo_url ? <img src={resolveImageUrl(e.photo_url)} alt="" className="w-full h-full object-cover" /> : (e.full_name?.split(" ").map((w) => w[0]).slice(0, 2).join("") || "?")}
              <input type="file" accept="image/*" className="hidden" onChange={async (ev) => {
                const raw = ev.target.files?.[0]; ev.target.value = ""; if (!raw) return;
                try {
                  const file = await compressImageFile(raw);
                  const fd = new FormData(); fd.append("file", file);
                  const r = await axios.post(`${API_URL}/files/upload?entity=employee_photo&entity_id=${encodeURIComponent(id)}&company_id=${encodeURIComponent(companyId)}`, fd);
                  toast.success(r.data?.saved_pct ? `Fotoğraf yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fotoğraf yüklendi.");
                  reload(); onChanged?.();
                } catch (err) { toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi."); }
              }} data-testid="emp-card-photo-input" />
            </label>
            <div className="min-w-0"><h3 className="text-base font-bold text-slate-900 truncate" data-testid="emp-card-name">{e.full_name}{isDailyWage(e) ? <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" data-testid="emp-card-yevmiye-badge">Yevmiye</span> : null}</h3><div className="text-xs text-indigo-600 font-semibold">{e.position} · {e.department}</div><div className="text-[11px] text-slate-400">İşe giriş: {formatTrDate(e.start_date)}{e.end_date ? ` · Ayrılış: ${formatTrDate(e.end_date)}` : ""} · TCKN: {e.tc_kimlik}</div></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0" data-testid="emp-card-close"><X className="w-5 h-5" /></button>
        </div>
          <div className="space-y-1.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button type="button" onClick={() => setTab("salary")} className={`${btn} bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200`} data-testid="emp-card-moves-btn"><Receipt className="w-3.5 h-3.5 inline mr-1" />Hareketler</button>
            <button type="button" onClick={() => setQuickPay({ type: "advance" })} className={`${btn} bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200`} data-testid="emp-card-advance-btn"><Wallet className="w-3.5 h-3.5 inline mr-1" />Avans</button>
            <button type="button" onClick={() => (isDailyWage(e) ? setLedgerOpen(true) : openSalaryPay())} disabled={busyPay} className={`${btn} bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 disabled:opacity-50`} data-testid="emp-card-salary-btn"><Banknote className="w-3.5 h-3.5 inline mr-1" />{employeePayActionTitle("salary", e)}</button>
            <button type="button" onClick={() => setQuickPay({ type: "expense", initialMode: "new" })} className={`${btn} bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-200`} data-testid="emp-card-expense-btn"><Receipt className="w-3.5 h-3.5 inline mr-1" />Masraf ekle</button>
            <button type="button" onClick={() => {
              const due = Number(card?.balance?.meal_due ?? e.meal_allowance ?? 0) || 0;
              setQuickPay({ type: "expense", category: "Yemek", description: "Yemek ücreti", amount: due > 0 ? due : "", initialMode: "new" });
            }} className={`${btn} bg-orange-50 hover:bg-orange-100 text-orange-800 border-orange-200`} title="Yemek ücreti — masraf" data-testid="emp-card-meal-btn"><UtensilsCrossed className="w-3.5 h-3.5 inline mr-1" />Yemek</button>
            <button type="button" onClick={() => {
              const due = Number(card?.balance?.transport_due ?? e.transport_allowance ?? 0) || 0;
              setQuickPay({ type: "expense", category: "Yol / Ulaşım", description: "Yol / ulaşım ödemesi", amount: due > 0 ? due : "", initialMode: "new" });
            }} className={`${btn} bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border-cyan-200`} title="Yol ödemesi — masraf" data-testid="emp-card-transport-btn"><Bus className="w-3.5 h-3.5 inline mr-1" />Yol</button>
            <button type="button" onClick={() => {
              if (isDailyWage(e)) {
                const unpaidYev = (card?.bonuses || []).filter((b) => b.type === "yevmiye" && b.status !== "paid");
                const haveDays = unpaidYev.reduce((s, b) => s + (Number(b.worked_days) || 0), 0);
                setYevmiyeOpen({ haveDays });
                return;
              }
              const due = Number(card?.balance?.bonus_pending || 0) || 0;
              setQuickPay({ type: "bonus", amount: due > 0 ? due : "" });
            }} className={`${btn} bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200`} data-testid="emp-card-bonus-btn">{employeePayActionTitle("bonus", e)}</button>
            <button type="button" onClick={() => {
              const due = Number(card?.balance?.overtime_due ?? card?.overtime?.amount ?? 0) || 0;
              setQuickPay({ type: "overtime", amount: due > 0 ? due : "" });
            }} className={`${btn} bg-violet-50 hover:bg-violet-100 text-violet-800 border-violet-200`} data-testid="emp-card-otpay-btn">Mesai öde</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5" data-testid="emp-card-work-actions">
            <button type="button" onClick={() => setTaskOpen(true)} className={`${btn} bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200`} data-testid="emp-card-task-btn"><ClipboardList className="w-3.5 h-3.5 inline mr-1" />Görev ata</button>
          </div>
          </div>
        </div>
        <div className="flex gap-1 px-5 border-b overflow-x-auto">{TABS.map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`emp-tab-${k}`}><I className="w-3.5 h-3.5" /> {l}</button>)}</div>
        <div className="p-5 overflow-y-auto text-xs">
          {!card ? <div className="text-slate-400">Yükleniyor…</div> : (<>
            {tab === "summary" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label={isDailyWage(e) ? "Yevmiye" : "Net Maaş"} value={isDailyWage(e) ? `${fmt(e.daily_wage)} ₺ / gün` : `${fmt(e.salary)} ₺`} sub={isDailyWage(e) ? `${card.attendance.days_present || 0} gün = ${fmt(periodWage(e, card.attendance.days_present))} ₺ · tahmini ay ${fmt(monthlyLoad(e))} ₺` : `Bordro brüt ${fmt(e.payroll_salary || e.salary * 1.4)} ₺${e.second_salary ? ` · 2. maaş ${fmt(e.second_salary)} ₺` : ""}`} testid="emp-stat-salary" /><Stat label="Kalan İzin" value={`${card.leave_balance.remaining} / ${card.leave_balance.annual} gün`} testid="emp-stat-leave" />
                  <Stat label="Bu Ay Çalışma" value={`${card.attendance.days_present} gün · ${card.attendance.total_hours} sa`} testid="emp-stat-att" /><Stat label="Toplam Prim/Avans" value={`${fmt(card.totals.bonus_total)} ₺`} testid="emp-stat-bonus" />
                  <Stat label="Kalan Alacak" value={`${fmt(remaining)} ₺`} sub={card.balance?.month ? `Dönem ${card.balance.month}` : undefined} testid="emp-stat-remaining" valueClass={TONE[remainingTone(remaining)]} />
                  <Stat label="Fazla Mesai" value={`${(Number(ot.hours || card.attendance.overtime_hours) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sa`} sub={`Ücret ${fmt(card.balance?.overtime_due ?? ot.amount ?? 0)} ₺${Number(ot.weekday_hours) || Number(ot.holiday_hours) ? ` · HF ${ot.weekday_hours || 0} / tatil ${ot.holiday_hours || 0}` : ""}`} testid="emp-stat-overtime" />
                  {(() => {
                    const unpaidYev = (card.bonuses || []).filter((b) => b.type === "yevmiye" && b.status !== "paid");
                    const yevDays = unpaidYev.reduce((s, b) => s + (Number(b.worked_days) || 0), 0) || (card.attendance.days_present || 0);
                    const yevAmt = unpaidYev.reduce((s, b) => s + (Number(b.amount) || 0), 0) || periodWage(e, yevDays);
                    return (
                      <Stat
                        label={isDailyWage(e) ? "Yevmiye günü" : "Prim hakedişi"}
                        value={isDailyWage(e) ? `${yevDays} gün` : `${fmt(card.balance?.bonus_pending || 0)} ₺`}
                        sub={isDailyWage(e) ? `${fmt(yevAmt)} ₺ · ${fmt(e.daily_wage)} ₺ / gün` : undefined}
                        testid="emp-stat-bonus-due"
                      />
                    );
                  })()}
                  <Stat label="İşe Giriş" value={formatTrDate(e.start_date)} testid="emp-stat-start" />
                  <Stat label="İşten Ayrılma" value={formatTrDate(e.end_date)} sub={e.status === "terminated" ? "İşten çıkarıldı" : undefined} testid="emp-stat-end" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-700"><div><b>Telefon:</b> {e.phone || "-"}</div><div><b>E-posta:</b> {e.email || "-"}</div><div><b>Durum:</b> {empStatusLabel(e.status)}</div><div><b>Sistem kullanıcısı:</b> {card.user ? card.user.email : "Yok"}</div></div>
                {card.workplace?.kind === "task" || (card.tasks || []).some((t) => !t.done) ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-indigo-900 space-y-1.5" data-testid="emp-card-workplace">
                    <div className="font-bold">Görev / çalıştığı yer</div>
                    {card.workplace?.kind === "task" ? (
                      <>
                        <div className="text-[11px]">{workplaceHint(card.workplace, true)}</div>
                        {card.workplace.address ? <div className="text-[11px] text-indigo-700">{card.workplace.address}</div> : null}
                      </>
                    ) : null}
                    {(card.tasks || []).filter((t) => !t.done).length ? (
                      <ul className="text-[11px] space-y-0.5" data-testid="emp-card-tasks">
                        {(card.tasks || []).filter((t) => !t.done).slice(0, 8).map((t, i) => (
                          <li key={t.id || i}>
                            {t.title || "Görev"}
                            {t.project_number || t.project_name ? ` · ${t.project_number || t.project_name}` : ""}
                            {t.kind === "office" ? " · iç görev" : t.duration_days ? ` · ${t.duration_days} gün` : t.due_date ? ` · ${t.due_date}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                <div className="border border-slate-100 rounded-xl p-3 space-y-3" data-testid="emp-performance">
                  <div className="flex items-center justify-between"><div className="font-bold text-slate-800">Performans</div><div className={`text-sm font-black ${TONE[performanceTone(perf.overall)]}`} data-testid="emp-perf-overall">%{perf.overall ?? 0}</div></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PerfBar label="Giriş" pct={perf.check_in?.pct} sub={`${perf.check_in?.ok ?? 0} / ${perf.check_in?.expected ?? 0} iş günü`} testid="emp-perf-checkin" />
                    <PerfBar label="Çıkış" pct={perf.check_out?.pct} sub={`${perf.check_out?.ok ?? 0} / ${perf.check_out?.expected ?? 0} iş günü`} testid="emp-perf-checkout" />
                    <PerfBar label="İzin" pct={perf.leave?.pct} sub={`Onaylı ${perf.leave?.approved_days ?? 0} gün · devamsız ${perf.leave?.absent_days ?? 0}`} testid="emp-perf-leave" />
                    <PerfBar label="Görev" pct={perf.task?.pct} sub={`${perf.task?.done ?? 0} / ${perf.task?.total ?? 0} tamamlandı`} testid="emp-perf-task" />
                  </div>
                </div>
                <div className="text-slate-500">Belgeler: {card.documents.length} · Bordro: {card.payrolls.length} dönem · Ödenen maaş toplamı: {fmt(card.totals.paid_salary)} ₺</div>
                {e.status !== "terminated" ? (
                  <div className="pt-1">
                    <button type="button" onClick={() => { setTermDate(new Date().toISOString().slice(0, 10)); setTermOk(false); setTermOpen(true); }} className={`${btn} bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200`} data-testid="emp-terminate-btn">
                      <UserMinus className="w-3.5 h-3.5 inline mr-1" /> İşten çıkar
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            {tab === "docs" && <Docs card={card} companyId={companyId} reload={reload} />}
            {tab === "salary" && (
              <div className="space-y-5" data-testid="emp-pay-moves">
                <table className="w-full" data-testid="emp-salary-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Dönem</th><th className="text-right">Brüt</th><th className="text-right">Net</th><th className="text-right">Prim</th><th className="text-right">Durum</th></tr></thead>
                  <tbody className="divide-y">{card.payrolls.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Bordro kaydı yok.</td></tr>}{card.payrolls.map((p) => <tr key={p.id}><td className="py-1.5 font-semibold">{p.period}{isDailyWage(p) ? <div className="text-[10px] font-medium text-amber-700">{payrollWageLine(p)}</div> : null}</td><td className="text-right">{fmt(p.gross_salary)} ₺</td><td className="text-right font-bold">{fmt(p.net_salary)} ₺</td><td className="text-right">{fmt(p.bonus)} ₺</td><td className="text-right"><Badge s={p.status} /></td></tr>)}</tbody></table>
                <div>
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Avans / prim / masraf</div>
                  <table className="w-full" data-testid="emp-bonus-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Tür</th><th className="text-left">Dönem</th><th className="text-left">Hesap</th><th className="text-right">Tutar</th><th className="text-right">Durum</th></tr></thead>
                    <tbody className="divide-y">{!(card.bonuses || []).length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Avans veya prim yok.</td></tr>}{(card.bonuses || []).map((b) => <tr key={b.id}><td className="py-1.5 font-semibold">{b.type_label || b.type}{b.type === "yevmiye" && b.worked_days ? <div className="text-[10px] font-medium text-amber-700">{b.worked_days} gün{b.daily_wage ? ` × ${fmt(b.daily_wage)} ₺` : ""}</div> : null}</td><td>{b.period || "—"}</td><td className="text-slate-500">{b.account_name || b.note || "—"}</td><td className="text-right font-bold">{fmt(b.amount)} ₺</td><td className="text-right"><Badge s={b.status} />{b.type === "yevmiye" && b.status !== "paid" ? <div className="flex justify-end gap-2 mt-0.5"><button type="button" className="text-[10px] text-indigo-700 font-semibold" onClick={() => setYevmiyeOpen({ editId: b.id, haveDays: 0, initialDays: String(b.worked_days || ""), initialWage: String(b.daily_wage || e.daily_wage || ""), initialNote: b.note || "" })}>düzenle</button><button type="button" className="text-[10px] text-rose-700 font-semibold" data-testid={`emp-yevmiye-row-del-${b.id}`} onClick={async () => { if (!window.confirm("Bu yevmiye kaydı silinsin mi?")) return; try { await axios.delete(`${API_URL}/personnel/bonuses/${b.id}`); toast.success("Yevmiye kaydı silindi."); afterMoney(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }}>sil</button></div> : null}</td></tr>)}</tbody></table>
                </div>
              </div>
            )}
            {tab === "leaves" && (
              <div className="space-y-3"><div className="grid grid-cols-3 gap-2"><Stat label="Yıllık Hak" value={`${card.leave_balance.annual} gün`} /><Stat label="Kullanılan" value={`${card.leave_balance.used} gün`} /><Stat label="Kalan" value={`${card.leave_balance.remaining} gün`} testid="emp-leave-remaining" /></div>
                <table className="w-full" data-testid="emp-leaves-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Tür</th><th className="text-left">Tarih</th><th className="text-right">Gün</th><th className="text-left pl-3">Açıklama</th><th className="text-right">Durum</th></tr></thead>
                  <tbody className="divide-y">{card.leaves.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">İzin kaydı yok.</td></tr>}{card.leaves.map((l) => <tr key={l.id}><td className="py-1.5 font-semibold">{LEAVE[l.type] || l.type}</td><td>{l.start_date} → {l.end_date}</td><td className="text-right">{l.days}</td><td className="pl-3 text-slate-500">{l.reason}</td><td className="text-right"><Badge s={l.status} /></td></tr>)}</tbody></table></div>
            )}
            {tab === "attendance" && (
              <div className="space-y-3" data-testid="emp-attendance">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2"><Stat label={`Ay (${card.attendance.month})`} value="Özet" /><Stat label="Çalışılan Gün" value={card.attendance.days_present} /><Stat label="Devamsız" value={card.attendance.days_absent} /><Stat label="İzinli" value={card.attendance.days_leave} /><Stat label="Toplam / Mesai Saat" value={`${card.attendance.total_hours} / ${card.attendance.overtime_hours}`} />{isDailyWage(e) ? <Stat label="Yevmiye hak ediş" value={`${fmt(periodWage(e, card.attendance.days_present))} ₺`} sub={`${card.attendance.days_present || 0} gün × ${fmt(e.daily_wage)} ₺`} testid="emp-att-yevmiye" /> : null}</div>
                {card.workplace?.kind === "task" ? <div className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg p-2" data-testid="emp-att-workplace">Dış görev: {workplaceShort(card.workplace)} — giriş/çıkış görev yerinden</div> : null}
              </div>
            )}
            {tab === "pay" && <EmployeeCompensationForm key={card.employee.updated_at || card.employee.id} employee={card.employee} companySchedule={schedule} onSaved={reload} />}
            {tab === "user" && <UserTab card={card} reload={reload} />}
          </>)}
        </div>
      </div>
      {quickPay && <QuickPayModal
        payroll={payStub()}
        type={quickPay.type || quickPay}
        companyId={companyId}
        accounts={accounts}
        initialMode={quickPay.initialMode || ((quickPay.type || quickPay) === "expense" ? "new" : undefined)}
        initialCategory={quickPay.category}
        initialDescription={quickPay.description}
        initialAmount={quickPay.amount}
        allowances={{
          meal: e?.meal_allowance,
          transport: e?.transport_allowance,
          mealDue: card?.balance?.meal_due,
          transportDue: card?.balance?.transport_due,
        }}
        onClose={() => setQuickPay(null)}
        onDone={afterMoney}
      />}
      {taskOpen ? <EmployeeAssignTaskModal employee={e} companyId={companyId} onClose={() => setTaskOpen(false)} onSaved={afterMoney} /> : null}
      {ledgerOpen ? (
        <EmployeeLedgerModal
          employee={e}
          companyId={companyId}
          accounts={accounts}
          remaining={remaining}
          advances={Number(card?.balance?.advances) || 0}
          onClose={() => setLedgerOpen(false)}
          onDone={afterMoney}
        />
      ) : null}
      {yevmiyeOpen ? (
        <EmployeeYevmiyeModal
          employee={e}
          companyId={companyId}
          accounts={accounts}
          haveDays={yevmiyeOpen.haveDays || 0}
          editId={yevmiyeOpen.editId || ""}
          initialDays={yevmiyeOpen.initialDays || ""}
          initialWage={yevmiyeOpen.initialWage || ""}
          initialNote={yevmiyeOpen.initialNote || ""}
          onClose={() => setYevmiyeOpen(null)}
          onDone={afterMoney}
        />
      ) : null}
      {payItem && (() => {
        const sgkPay = Boolean(String((card?.employee || e)?.sgk_number || "").trim());
        const empIban = (card?.employee || e)?.iban;
        return (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={(ev) => { ev.stopPropagation(); setPayItem(null); }} data-testid="emp-card-salary-modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Maaş Ödemesi</h3>
              <button type="button" onClick={() => setPayItem(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-xs text-slate-700 space-y-3">
              <p><strong>{payItem.employee_name || e.full_name}</strong> için <strong>{payItem.period}</strong> dönemi <strong>{fmt(payItem.final_payable ?? payItem.net_salary)} ₺</strong> maaş ödemesi yapılacaktır.</p>
              {sgkPay && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900" data-testid="emp-card-sgk-bank-hint">
                  SGK sicil no kayıtlı — ana maaş yalnız <b>banka hesabı</b>ndan ödenir.
                  {empIban ? <div className="mt-1 font-mono text-[11px]">Personel IBAN: {empIban}</div> : <div className="mt-1 text-rose-700 font-semibold">Personel IBAN eksik.</div>}
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{sgkPay ? "Banka hesabı" : "Ödemenin yapılacağı hesap"}</label>
                <PaymentTargetSelect
                  companyId={companyId}
                  accounts={accounts}
                  value={payAccountId}
                  onChange={setPayAccountId}
                  testId="emp-card-salary-account"
                  allowedTypes={sgkPay ? ["bank"] : null}
                  includePartners={!sgkPay}
                  includeCreditCards={!sgkPay}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPayItem(null)} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button>
              <button type="button" onClick={confirmSalaryPay} disabled={busyPay || !payAccountId} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="emp-card-salary-confirm">Ödemeyi Tamamla</button>
            </div>
          </div>
        </div>
        );
      })()}
      {termOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={(ev) => { ev.stopPropagation(); setTermOpen(false); setTermOk(false); }} data-testid="emp-terminate-modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-rose-800 flex items-center gap-1.5"><UserMinus className="w-4 h-4" /> İşten çıkar</h3>
              <button type="button" onClick={() => { setTermOpen(false); setTermOk(false); }} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-xs text-slate-700 space-y-3">
              <p><strong>{e.full_name}</strong> işten çıkarılacak. Bağlı sistem kullanıcısı pasifleşir; personel kartı silinmez.</p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">İşten ayrılma tarihi</label>
                <input type="date" value={termDate} onChange={(ev) => setTermDate(ev.target.value)} className="w-full border rounded-lg p-2" data-testid="emp-terminate-date" />
              </div>
              <label className="flex items-start gap-2 text-slate-700">
                <input type="checkbox" checked={termOk} onChange={(ev) => setTermOk(ev.target.checked)} className="mt-0.5" data-testid="emp-terminate-confirm-check" />
                <span><strong>{e.full_name}</strong> adlı personeli işten çıkarmayı onaylıyorum.</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => { setTermOpen(false); setTermOk(false); }} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button>
              <button type="button" onClick={confirmTerminate} disabled={busyTerm || !termOk} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="emp-terminate-confirm">İşten çıkar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
