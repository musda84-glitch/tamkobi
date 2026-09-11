import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, User, FileText, Wallet, CalendarDays, Clock, KeyRound, Upload, Trash2, ExternalLink, Loader2, Mail, Banknote, Receipt } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { resolveImageUrl } from "../utils/imageUrl";
import { EmployeeCompensationForm } from "./WorkScheduleSettings";
import { QuickPayModal } from "./QuickPayModal";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TABS = [["summary", "Özet", User], ["docs", "Belgeler", FileText], ["salary", "Maaş Geçmişi", Wallet], ["pay", "Ücret & Mesai", Banknote], ["leaves", "İzinler", CalendarDays], ["attendance", "Puantaj", Clock], ["user", "Sistem Kullanıcısı", KeyRound]];
const LEAVE = { annual: "Yıllık", sick: "Hastalık", unpaid: "Ücretsiz", other: "Diğer" };
const ST = { pending: ["Bekliyor", "bg-amber-100 text-amber-700"], approved: ["Onaylı", "bg-emerald-100 text-emerald-700"], rejected: ["Red", "bg-rose-100 text-rose-700"], paid: ["Ödendi", "bg-emerald-100 text-emerald-700"], unpaid: ["Ödenmedi", "bg-slate-100 text-slate-600"] };
const Badge = ({ s }) => { const [l, c] = ST[s] || [s, "bg-slate-100 text-slate-600"]; return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c}`}>{l}</span>; };
const Stat = ({ label, value, sub, testid }) => <div className="bg-slate-50 rounded-xl p-3"><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className="text-sm font-bold text-slate-900" data-testid={testid}>{value}</div>{sub && <div className="text-[10px] text-slate-500">{sub}</div>}</div>;

const Docs = ({ card, companyId, reload }) => {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append("file", file); await axios.post(`${API_URL}/files/upload?entity=employee&entity_id=${card.employee.id}&company_id=${companyId}`, fd); toast.success("Belge yüklendi."); reload(); }
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
  const [payItem, setPayItem] = useState(null);
  const [payAccountId, setPayAccountId] = useState("");
  const [busyPay, setBusyPay] = useState(false);
  useEscape(() => {
    if (quickPay) return;
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
    setPayItem(item);
  };
  const confirmSalaryPay = async () => {
    if (!payItem) return;
    setBusyPay(true);
    try {
      const res = await axios.post(`${API_URL}/personnel/payrolls/${payItem.id || payItem._id}/pay`, { account_id: payAccountId });
      toast.success(res.data.message);
      setPayItem(null);
      afterMoney();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Maaş ödemesi gerçekleştirilemedi.");
    } finally { setBusyPay(false); }
  };
  const btn = "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap";
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={(ev) => ev.stopPropagation()} data-testid="employee-card-modal">
        <div className="flex items-start justify-between p-5 border-b gap-3">
          <div className="flex items-center gap-3 min-w-0"><div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-lg shrink-0">{e.full_name?.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
            <div className="min-w-0"><h3 className="text-base font-bold text-slate-900 truncate" data-testid="emp-card-name">{e.full_name}</h3><div className="text-xs text-indigo-600 font-semibold">{e.position} · {e.department}</div><div className="text-[11px] text-slate-400">Başlangıç: {e.start_date} · TCKN: {e.tc_kimlik}</div></div></div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
            <button type="button" onClick={() => setQuickPay("advance")} className={`${btn} bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200`} data-testid="emp-card-advance-btn"><Wallet className="w-3.5 h-3.5 inline mr-1" />Avans</button>
            <button type="button" onClick={openSalaryPay} disabled={busyPay} className={`${btn} bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200 disabled:opacity-50`} data-testid="emp-card-salary-btn"><Banknote className="w-3.5 h-3.5 inline mr-1" />Maaş</button>
            <button type="button" onClick={() => setQuickPay("expense")} className={`${btn} bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-200`} data-testid="emp-card-expense-btn"><Receipt className="w-3.5 h-3.5 inline mr-1" />Masraf ekle</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1" data-testid="emp-card-close"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex gap-1 px-5 border-b overflow-x-auto">{TABS.map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`emp-tab-${k}`}><I className="w-3.5 h-3.5" /> {l}</button>)}</div>
        <div className="p-5 overflow-y-auto text-xs">
          {!card ? <div className="text-slate-400">Yükleniyor…</div> : (<>
            {tab === "summary" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Net Maaş" value={`${fmt(e.salary)} ₺`} sub={`Bordro brüt ${fmt(e.payroll_salary || e.salary * 1.4)} ₺${e.second_salary ? ` · 2. maaş ${fmt(e.second_salary)} ₺` : ""}`} testid="emp-stat-salary" /><Stat label="Kalan İzin" value={`${card.leave_balance.remaining} / ${card.leave_balance.annual} gün`} testid="emp-stat-leave" />
                  <Stat label="Bu Ay Çalışma" value={`${card.attendance.days_present} gün · ${card.attendance.total_hours} sa`} testid="emp-stat-att" /><Stat label="Toplam Prim/Avans" value={`${fmt(card.totals.bonus_total)} ₺`} testid="emp-stat-bonus" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-700"><div><b>Telefon:</b> {e.phone || "-"}</div><div><b>E-posta:</b> {e.email || "-"}</div><div><b>Durum:</b> {e.status === "active" ? "Aktif" : e.status}</div><div><b>Sistem kullanıcısı:</b> {card.user ? card.user.email : "Yok"}</div></div>
                <div className="text-slate-500">Belgeler: {card.documents.length} · Bordro: {card.payrolls.length} dönem · Ödenen maaş toplamı: {fmt(card.totals.paid_salary)} ₺</div>
              </div>
            )}
            {tab === "docs" && <Docs card={card} companyId={companyId} reload={reload} />}
            {tab === "salary" && (
              <table className="w-full" data-testid="emp-salary-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Dönem</th><th className="text-right">Brüt</th><th className="text-right">Net</th><th className="text-right">Prim</th><th className="text-right">Durum</th></tr></thead>
                <tbody className="divide-y">{card.payrolls.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Bordro kaydı yok.</td></tr>}{card.payrolls.map((p) => <tr key={p.id}><td className="py-1.5 font-semibold">{p.period}</td><td className="text-right">{fmt(p.gross_salary)} ₺</td><td className="text-right font-bold">{fmt(p.net_salary)} ₺</td><td className="text-right">{fmt(p.bonus)} ₺</td><td className="text-right"><Badge s={p.status} /></td></tr>)}</tbody></table>
            )}
            {tab === "leaves" && (
              <div className="space-y-3"><div className="grid grid-cols-3 gap-2"><Stat label="Yıllık Hak" value={`${card.leave_balance.annual} gün`} /><Stat label="Kullanılan" value={`${card.leave_balance.used} gün`} /><Stat label="Kalan" value={`${card.leave_balance.remaining} gün`} testid="emp-leave-remaining" /></div>
                <table className="w-full" data-testid="emp-leaves-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Tür</th><th className="text-left">Tarih</th><th className="text-right">Gün</th><th className="text-left pl-3">Açıklama</th><th className="text-right">Durum</th></tr></thead>
                  <tbody className="divide-y">{card.leaves.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">İzin kaydı yok.</td></tr>}{card.leaves.map((l) => <tr key={l.id}><td className="py-1.5 font-semibold">{LEAVE[l.type] || l.type}</td><td>{l.start_date} → {l.end_date}</td><td className="text-right">{l.days}</td><td className="pl-3 text-slate-500">{l.reason}</td><td className="text-right"><Badge s={l.status} /></td></tr>)}</tbody></table></div>
            )}
            {tab === "attendance" && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="emp-attendance"><Stat label={`Ay (${card.attendance.month})`} value="Özet" /><Stat label="Çalışılan Gün" value={card.attendance.days_present} /><Stat label="Devamsız" value={card.attendance.days_absent} /><Stat label="İzinli" value={card.attendance.days_leave} /><Stat label="Toplam / Mesai Saat" value={`${card.attendance.total_hours} / ${card.attendance.overtime_hours}`} /></div>
            )}
            {tab === "pay" && <EmployeeCompensationForm key={card.employee.updated_at || card.employee.id} employee={card.employee} companySchedule={schedule} onSaved={reload} />}
            {tab === "user" && <UserTab card={card} reload={reload} />}
          </>)}
        </div>
      </div>
      {quickPay && <QuickPayModal payroll={payStub()} type={quickPay} companyId={companyId} accounts={accounts} initialMode={quickPay === "expense" ? "new" : undefined} onClose={() => setQuickPay(null)} onDone={afterMoney} />}
      {payItem && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={(ev) => { ev.stopPropagation(); setPayItem(null); }} data-testid="emp-card-salary-modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Maaş Ödemesi</h3>
              <button type="button" onClick={() => setPayItem(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-xs text-slate-700 space-y-3">
              <p><strong>{payItem.employee_name || e.full_name}</strong> için <strong>{payItem.period}</strong> dönemi <strong>{fmt(payItem.final_payable ?? payItem.net_salary)} ₺</strong> maaş ödemesi yapılacaktır.</p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ödemenin yapılacağı hesap</label>
                <select value={payAccountId} onChange={(ev) => setPayAccountId(ev.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium" data-testid="emp-card-salary-account">
                  {accounts.map((b) => <option key={b.id || b._id} value={b.id || b._id}>{b.account_name || b.bank_name} ({fmt(b.current_balance)} ₺)</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setPayItem(null)} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button>
              <button type="button" onClick={confirmSalaryPay} disabled={busyPay || !payAccountId} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="emp-card-salary-confirm">Ödemeyi Tamamla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
