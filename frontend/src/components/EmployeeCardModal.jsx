import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, User, FileText, Wallet, CalendarDays, Clock, KeyRound, Upload, Trash2, ExternalLink, Loader2, Mail, Banknote, Receipt, ClipboardList, UserMinus, MessageSquare, RotateCcw } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { EmployeeCompensationForm } from "./WorkScheduleSettings";
import { EmployeePayModal } from "./EmployeePayModal";
import { EmployeeAssignTaskModal } from "./EmployeeAssignTaskModal";
import { EmployeeYevmiyeModal } from "./EmployeeYevmiyeModal";
import { EmployeeMovesModal } from "./EmployeeMovesModal";
import { EmployeePuantajPanel } from "./EmployeePuantajPanel";
import { empStatusLabel, formatTrDate, performanceTone, remainingTone, parseAnnualLeaveDays, annualLeaveDaysError, annualLeaveDaysPayload } from "../utils/employeeCardSummary";
import { bonusPaidDate, employeePayButtonLabel, employeePresenceChip, payMoveCanDelete, payMoveDeleteConfirm, payMoveDeletePath, empDataResetConfirm, empDataResetPath } from "../utils/personnelCard";
import { roleCodeFromPosition } from "../utils/employeePosition";
import { formatTrAmount } from "../utils/money";
import { isDailyWage, monthlyLoad, payrollWageLine, periodWage } from "../utils/personnelWage";
import { workplaceHint, workplaceShort } from "../utils/workplace";
import { archivedAssignedDuties, dutyFromCurrent, openAssignedDuties, pendingDutyPhotoCount } from "../utils/assignedDuty";
import { AssignedDutyCard } from "./AssignedDutyCard";
import { StaffMessagesPanel } from "./StaffMessagesPanel";
import { backdropDismissProps } from "../utils/modalBackdrop";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const TABS = [["summary", "Özet", User], ["docs", "Belgeler", FileText], ["salary", "Ödemeler", Wallet], ["pay", "Ücret & Mesai", Banknote], ["leaves", "İzinler", CalendarDays], ["attendance", "Puantaj", Clock], ["user", "Sistem", KeyRound]];
const LEAVE = { annual: "Yıllık", sick: "Hastalık", unpaid: "Ücretsiz", other: "Diğer" };
const ST = { pending: ["Bekliyor", "bg-amber-100 text-amber-700"], approved: ["Onaylı", "bg-emerald-100 text-emerald-700"], rejected: ["Red", "bg-rose-100 text-rose-700"], cancelled: ["İptal", "bg-slate-100 text-slate-600"], paid: ["Ödendi", "bg-emerald-100 text-emerald-700"], unpaid: ["Ödenmedi", "bg-slate-100 text-slate-600"] };
const TONE = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700", slate: "text-slate-900" };
const BAR = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" };
const Badge = ({ s, date }) => {
  const [l, c] = ST[s] || [s, "bg-slate-100 text-slate-600"];
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c}`}>{l}</span>
      {s === "paid" && date ? (
        <span className="text-[10px] font-medium text-slate-500" data-testid="emp-bonus-paid-date">{formatTrDate(date)}</span>
      ) : null}
    </span>
  );
};
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

const UserTab = ({ card, reload, onResetData }) => {
  const { user: me } = useAuth();
  const emp = card.employee || {};
  const companyId = emp.company_id;
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({ email: emp.email || "", role: "sales", password: "", mode: "invite" });
  const [busy, setBusy] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/personnel/role-options`, { params: { company_id: companyId } })
      .then((r) => {
        const list = r.data?.roles || [];
        setRoles(list);
        setForm((f) => ({ ...f, role: roleCodeFromPosition(list, emp.position, f.role || "sales") }));
      })
      .catch(() => setRoles([]));
  }, [companyId, emp.position]);
  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/employees/${emp.id}/create-user`, { email: form.email, role: form.role, password: form.mode === "password" ? form.password : undefined, base_url: window.location.origin, invited_by: me?.id });
      toast.success(r.data.message); reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Oluşturulamadı."); } finally { setBusy(false); }
  };
  const changeRole = async (role) => {
    if (!card.user?.id || role === card.user.role) return;
    setRoleBusy(true);
    try {
      await axios.put(`${API_URL}/users/${card.user.id}`, { role });
      toast.success("Rol güncellendi.");
      reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Rol güncellenemedi."); } finally { setRoleBusy(false); }
  };
  const cancelInvite = async () => {
    const invId = card.pending_invite?.id || card.pending_invite?._id;
    if (!invId) return;
    if (!window.confirm("Bekleyen davet iptal edilsin mi?")) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/users/invite/${invId}`);
      toast.success("Davet iptal edildi.");
      reload();
    } catch (err) { toast.error(err.response?.data?.detail || "İptal edilemedi."); } finally { setBusy(false); }
  };
  if (card.user) {
    const roleLabel = card.user.role_name || roles.find((r) => r.code === card.user.role)?.name || card.user.role;
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-2" data-testid="emp-user-linked">
        <div className="font-bold text-emerald-800 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Sistem kullanıcısı bağlı</div>
        <div><b>E-posta:</b> {card.user.email}</div>
        <div className="flex flex-wrap items-center gap-2">
          <b>Rol:</b>
          <select
            value={card.user.role}
            disabled={roleBusy || !roles.length}
            onChange={(e) => changeRole(e.target.value)}
            className="border rounded-lg p-1.5 bg-white min-w-[10rem]"
            data-testid="emp-user-linked-role"
          >
            {roles.length ? roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>) : <option value={card.user.role}>{roleLabel}</option>}
          </select>
          {roleBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" /> : null}
        </div>
        <div><b>Durum:</b> {card.user.is_active ? "Aktif" : "Pasif"}</div>
        <div><b>Son giriş:</b> {card.user.last_login_at ? new Date(card.user.last_login_at).toLocaleString("tr-TR") : "-"}</div>
        <div className="text-slate-500 pt-1">Şifre ve aktif/pasif için Firma Ayarları → Kullanıcılar & Roller.</div>
        <button
          type="button"
          onClick={onResetData}
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-white text-rose-700 font-semibold hover:bg-rose-50"
          data-testid="emp-data-reset-btn"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Personel verilerini sıfırla
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={create} className="space-y-3 text-xs" data-testid="emp-create-user-form">
      {card.pending_invite && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800 flex flex-wrap items-center gap-2" data-testid="emp-pending-invite">
          <span>Bekleyen davet: {card.pending_invite.email}{card.pending_invite.role_name || card.pending_invite.role ? ` · ${card.pending_invite.role_name || roles.find((r) => r.code === card.pending_invite.role)?.name || card.pending_invite.role}` : ""}</span>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(card.pending_invite.link); toast.success("Link kopyalandı."); } catch { window.prompt("Davet linki:", card.pending_invite.link); } }} className="underline" data-testid="emp-invite-copy">linki kopyala</button>
          <button type="button" disabled={busy} onClick={cancelInvite} className="ml-auto text-rose-700 font-semibold underline" data-testid="emp-invite-cancel">İptal et</button>
        </div>
      )}
      <div><label className="block font-semibold mb-1">E-posta (giriş adı)</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-email" /></div>
      <div><label className="block font-semibold mb-1">Rol</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-role">{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></div>
      <div className="flex gap-2">{[["invite", "E-posta ile davet gönder"], ["password", "Şifreyi ben belirleyeyim"]].map(([k, l]) => <button type="button" key={k} onClick={() => setForm({ ...form, mode: k })} className={`flex-1 border rounded-lg p-2 font-semibold ${form.mode === k ? "bg-slate-900 text-white" : "bg-white"}`} data-testid={`emp-user-mode-${k}`}>{l}</button>)}</div>
      {form.mode === "password" && <div><label className="block font-semibold mb-1">Şifre (en az 6)</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-lg p-2" data-testid="emp-user-password" /></div>}
      <button disabled={busy} className="w-full py-2 bg-emerald-600 text-white rounded-lg font-bold flex items-center justify-center gap-1.5" data-testid="emp-user-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : form.mode === "invite" ? <Mail className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />} {form.mode === "invite" ? "Davet Gönder" : "Kullanıcıyı Oluştur"}</button>
      <button
        type="button"
        onClick={onResetData}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100"
        data-testid="emp-data-reset-btn"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Personel verilerini sıfırla
      </button>
    </form>
  );
};

export const EmployeeCardModal = ({ employee, companyId, accounts: accountsProp, onClose, onChanged }) => {
  const [tab, setTab] = useState("summary");
  const [card, setCard] = useState(null);
  const id = employee.id || employee._id;
  const [schedule, setSchedule] = useState(null);
  const [accounts, setAccounts] = useState(accountsProp || []);
  const [unifyPay, setUnifyPay] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [yevmiyeOpen, setYevmiyeOpen] = useState(null);
  const [movesOpen, setMovesOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [termOk, setTermOk] = useState(false);
  const [termDate, setTermDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busyTerm, setBusyTerm] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetOk, setResetOk] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [showArchivedDuties, setShowArchivedDuties] = useState(false);
  const [trashDutiesBusy, setTrashDutiesBusy] = useState(false);
  const [annualDraft, setAnnualDraft] = useState("");
  const [annualBusy, setAnnualBusy] = useState(false);
  useEscape(() => {
    if (unifyPay) return;
    if (resetOpen) { setResetOpen(false); setResetOk(false); return; }
    if (termOpen) { setTermOpen(false); setTermOk(false); return; }
    if (msgOpen) { setMsgOpen(false); return; }
    if (taskOpen) { setTaskOpen(false); return; }
    if (yevmiyeOpen) { setYevmiyeOpen(null); return; }
    if (movesOpen) { setMovesOpen(false); return; }
    onClose();
  });
  const reload = useCallback(() => axios.get(`${API_URL}/personnel/employees/${id}/card`).then((r) => setCard(r.data)).catch(() => toast.error("Personel kartı yüklenemedi.")), [id]);
  useEffect(() => { reload(); axios.get(`${API_URL}/companies/${companyId}/work-schedule`).then((r) => setSchedule(r.data.schedule)).catch(() => {}); }, [reload, companyId]);
  useEffect(() => {
    const annual = card?.leave_balance?.annual ?? card?.employee?.annual_leave_days;
    if (annual == null) return;
    setAnnualDraft(String(annual));
  }, [card?.leave_balance?.annual, card?.employee?.annual_leave_days]);
  useEffect(() => {
    if (accountsProp?.length) { setAccounts(accountsProp); return; }
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => setAccounts(r.data)).catch(() => {});
  }, [accountsProp, companyId]);
  const e = card?.employee || employee;
  const afterMoney = () => { reload(); onChanged?.(); };
  const saveAnnualLeave = async () => {
    const err = annualLeaveDaysError(annualDraft);
    if (err) { toast.error(err); return; }
    const days = parseAnnualLeaveDays(annualDraft);
    setAnnualBusy(true);
    try {
      await axios.put(`${API_URL}/personnel/employees/${id}`, annualLeaveDaysPayload(days));
      toast.success("Yıllık izin hakkı güncellendi.");
      setCard((cur) => {
        if (!cur) return cur;
        const used = Number(cur.leave_balance?.used) || 0;
        const carry = Number(cur.leave_balance?.carry) || 0;
        const remaining = Math.max(0, days + carry - used);
        return {
          ...cur,
          employee: { ...(cur.employee || {}), annual_leave_days: days },
          leave_balance: { ...(cur.leave_balance || {}), annual: days, used, carry, remaining },
        };
      });
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İzin hakkı kaydedilemedi.");
    } finally { setAnnualBusy(false); }
  };
  const deletePayroll = async (p) => {
    const row = { id: p.id || p._id, kind: "payroll", status: p.status };
    const path = payMoveDeletePath(row);
    if (!payMoveCanDelete(row) || !path) return;
    const ask = payMoveDeleteConfirm(row);
    if (!window.confirm(`${ask.title}\n${ask.message}`)) return;
    try {
      await axios.delete(`${API_URL}${path}`);
      toast.success("Maaş kaydı silindi.");
      afterMoney();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
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
  const confirmResetData = async () => {
    if (!resetOk) return;
    const path = empDataResetPath(id);
    if (!path) return;
    setBusyReset(true);
    try {
      const res = await axios.post(`${API_URL}${path}`, { confirm: true });
      toast.success(res.data.message || "Personel verileri sıfırlandı.");
      setResetOpen(false);
      setResetOk(false);
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sıfırlanamadı.");
    } finally { setBusyReset(false); }
  };
  const btn = "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap w-full inline-flex items-center justify-center";
  const remaining = Number(card?.balance?.remaining) || 0;
  const ot = card?.overtime || {};
  const perf = card?.performance || {};
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
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
            <div className="min-w-0"><h3 className="text-base font-bold text-slate-900 truncate" data-testid="emp-card-name">{e.full_name}{isDailyWage(e) ? <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" data-testid="emp-card-yevmiye-badge">Yevmiye</span> : null}{(() => {
              const presence = employeePresenceChip({
                status: e.status,
                workplace: card?.workplace || e.workplace,
                location_last_inside: e.location_last_inside,
                location_last_ok: e.location_last_ok,
                location_inside_at: e.location_inside_at,
                today: card?.attendance?.today,
              });
              return presence ? (
                <span data-testid="emp-presence-modal" className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full border" style={{ color: presence.color, backgroundColor: presence.bg, borderColor: presence.border }}>{presence.label}</span>
              ) : null;
            })()}</h3><div className="text-xs text-indigo-600 font-semibold">{e.position} · {e.department}</div><div className="text-[11px] text-slate-400">İşe giriş: {formatTrDate(e.start_date)}{e.end_date ? ` · Ayrılış: ${formatTrDate(e.end_date)}` : ""} · TCKN: {e.tc_kimlik}</div></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0" data-testid="emp-card-close"><X className="w-5 h-5" /></button>
        </div>
          <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => setMovesOpen(true)} className={`${btn} bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200`} data-testid="emp-card-moves-btn"><Receipt className="w-3.5 h-3.5 inline mr-1" />Hareketler</button>
            <button type="button" onClick={() => setUnifyPay(true)} className={`${btn} bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200`} title="Maaş, mesai, prim, yemek, yol, masraf ve avans" data-testid="emp-card-pay-btn"><Banknote className="w-3.5 h-3.5 inline mr-1" />{employeePayButtonLabel({ balance: card?.balance })}</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5" data-testid="emp-card-work-actions">
            <button type="button" onClick={() => setTaskOpen(true)} className={`${btn} bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200`} data-testid="emp-card-task-btn"><ClipboardList className="w-3.5 h-3.5 inline mr-1" />Görev ata</button>
            <button type="button" onClick={() => setMsgOpen((v) => !v)} className={`${btn} bg-violet-50 hover:bg-violet-100 text-violet-800 border-violet-200`} data-testid="emp-card-msg-btn"><MessageSquare className="w-3.5 h-3.5 inline mr-1" />Mesaj</button>
          </div>
          {msgOpen ? <StaffMessagesPanel employeeId={id} testId="emp-card-messages" /> : null}
          </div>
        </div>
        <div className="flex flex-nowrap items-end gap-0.5 px-3 sm:px-5 border-b border-slate-200 overflow-x-auto shrink-0" data-testid="emp-card-tabs">
          {TABS.map(([k, l, I]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              title={k === "user" ? "Sistem Kullanıcısı" : l}
              className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 sm:px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              data-testid={`emp-tab-${k}`}
            >
              <I className="w-3.5 h-3.5 shrink-0" /> {l}
            </button>
          ))}
        </div>
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
                {card.workplace?.kind === "task" || (card.tasks || []).some((t) => !t.done) || archivedAssignedDuties(card.tasks).length > 0 ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-indigo-900 space-y-1.5" data-testid="emp-card-workplace">
                    <div className="font-bold">Görev / çalıştığı yer</div>
                    {card.workplace?.kind === "task" ? (
                      <>
                        <div className="text-[11px]">{workplaceHint(card.workplace, true)}</div>
                        {card.workplace.address ? <div className="text-[11px] text-indigo-700">{card.workplace.address}</div> : null}
                      </>
                    ) : null}
                    {(() => {
                      const openTasks = openAssignedDuties(card.tasks);
                      const restDone = archivedAssignedDuties(card.tasks);
                      const currentDuty = dutyFromCurrent({
                        tasks: openTasks,
                        current: card.workplace?.kind === "task"
                          ? { id: card.workplace.task_id, title: card.workplace.task_title, project: [card.workplace.project_number, card.workplace.project_name].filter(Boolean).join(" · ") }
                          : openTasks[0] || null,
                        workplace: card.workplace,
                      });
                      const currentOpen = currentDuty && !currentDuty.done ? currentDuty : null;
                      const restOpen = openTasks.filter((t) => !currentOpen || (t.id || t.title) !== (currentOpen.id || currentOpen.title));
                      if (!currentOpen && !restOpen.length && !restDone.length && !pendingDutyPhotoCount(card.tasks)) return null;
                      const trashCompleted = async () => {
                        if (!restDone.length || trashDutiesBusy) return;
                        if (!window.confirm(`${restDone.length} tamamlanan görev çöp kutusuna taşınsın mı? 30 gün içinde Çöp Kutusu’ndan geri getirilebilir.`)) return;
                        setTrashDutiesBusy(true);
                        try {
                          const r = await axios.post(`${API_URL}/personnel/employees/${id}/tasks/trash-completed`, {}, { withCredentials: true });
                          toast.success(r.data?.message || "Tamamlananlar çöpe taşındı.");
                          setShowArchivedDuties(false);
                          await reload();
                          onChanged?.();
                        } catch (err) {
                          toast.error(err.response?.data?.detail || "Çöpe taşınamadı.");
                        } finally {
                          setTrashDutiesBusy(false);
                        }
                      };
                      return (
                      <div className="space-y-2" data-testid="emp-card-tasks">
                        {pendingDutyPhotoCount(card.tasks) ? (
                          <div className="text-[11px] font-bold text-amber-800" data-testid="emp-card-photo-pending">
                            {pendingDutyPhotoCount(card.tasks)} iş fotoğrafı müşteri onayı bekliyor
                          </div>
                        ) : null}
                        {currentOpen ? (
                          <div data-testid="emp-card-current-duty">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 mb-1">Şu anda yaptığı iş</div>
                            <AssignedDutyCard
                              duty={currentOpen}
                              reviewPhotos
                              onChanged={() => reload()}
                              testId="emp-card-current-card"
                            />
                          </div>
                        ) : null}
                        {restOpen.slice(0, 8).map((t, i) => (
                          <AssignedDutyCard
                            key={t.id || i}
                            duty={t}
                            index={i}
                            testId={`emp-card-task-${t.id || i}`}
                            reviewPhotos
                            onChanged={() => reload()}
                          />
                        ))}
                        {restDone.length ? (
                          <div className="space-y-2" data-testid="emp-card-done-tasks">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                {showArchivedDuties ? `Arşiv · ${restDone.length} tamamlanan` : `Tamamlananlar arşivde (${restDone.length})`}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowArchivedDuties((v) => !v)}
                                  className="text-[10px] font-bold text-emerald-700 hover:underline"
                                  data-testid="emp-card-archive-toggle"
                                >
                                  {showArchivedDuties ? "Gizle" : `Arşiv (${restDone.length})`}
                                </button>
                                {showArchivedDuties ? (
                                  <button
                                    type="button"
                                    onClick={trashCompleted}
                                    disabled={trashDutiesBusy}
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 disabled:opacity-60"
                                    data-testid="emp-card-trash-done"
                                  >
                                    {trashDutiesBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    Çöpe taşı
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {showArchivedDuties ? restDone.slice(0, 8).map((t, i) => (
                              <AssignedDutyCard
                                key={t.id || i}
                                duty={t}
                                index={i}
                                testId={`emp-card-done-${t.id || i}`}
                                reviewPhotos
                                onChanged={() => reload()}
                              />
                            )) : (
                              <div className="text-[11px] text-slate-500" data-testid="emp-card-done-hidden">
                                Yapılan görevler gizli — Arşiv’den bakın, sonra çöp kutusuna taşıyın.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      );
                    })()}
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="emp-pay-balance-strip">
                  <span className="text-[10px] uppercase font-semibold text-slate-400">Kalan alacak</span>
                  <span className={`text-sm font-extrabold ${TONE[remainingTone(remaining)]}`} data-testid="emp-pay-remaining">{fmt(remaining)} ₺</span>
                  {Number(card.balance?.advances) > 0 ? (
                    <span className="text-[11px] font-bold text-amber-800" data-testid="emp-pay-advances">
                      · Açık avans −{fmt(card.balance.advances)} ₺
                      <span className="font-medium text-slate-500"> (hakedişte mahsup)</span>
                    </span>
                  ) : null}
                </div>
                <table className="w-full" data-testid="emp-salary-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Dönem</th><th className="text-right">Brüt</th><th className="text-right">Net</th><th className="text-right">Prim</th><th className="text-right">Durum</th></tr></thead>
                  <tbody className="divide-y">{card.payrolls.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Bordro kaydı yok.</td></tr>}{card.payrolls.map((p) => <tr key={p.id} data-testid={`emp-salary-row-${p.id}`}><td className="py-1.5 font-semibold">{p.period}{isDailyWage(p) ? <div className="text-[10px] font-medium text-amber-700">{payrollWageLine(p)}</div> : null}</td><td className="text-right">{fmt(p.gross_salary)} ₺</td><td className="text-right font-bold">{fmt(p.net_salary)} ₺</td><td className="text-right">{fmt(p.bonus)} ₺</td><td className="text-right"><div className="flex items-center justify-end gap-1.5"><Badge s={p.status} />{payMoveCanDelete({ id: p.id, kind: "payroll", status: p.status }) ? <button type="button" className="text-[10px] text-rose-700 font-semibold" data-testid={`emp-salary-del-${p.id}`} onClick={() => deletePayroll(p)}>sil</button> : null}</div></td></tr>)}</tbody></table>
                <div>
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Avans / prim / masraf</div>
                  <table className="w-full" data-testid="emp-bonus-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Tür</th><th className="text-left">Dönem</th><th className="text-left">Hesap</th><th className="text-right">Tutar</th><th className="text-right">Ödeme</th><th className="text-right">Durum</th></tr></thead>
                    <tbody className="divide-y">
                      {!(card.bonuses || []).length && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Avans veya prim yok.</td></tr>}
                      {(card.bonuses || []).map((b) => {
                        const paidOn = bonusPaidDate(b);
                        return (
                          <tr key={b.id} data-testid={`emp-bonus-row-${b.id}`}>
                            <td className="py-1.5 font-semibold">
                              {b.type_label || b.type}
                              {b.type === "yevmiye" && b.worked_days ? (
                                <div className="text-[10px] font-medium text-amber-700">{b.worked_days} gün{b.daily_wage ? ` × ${fmt(b.daily_wage)} ₺` : ""}</div>
                              ) : null}
                            </td>
                            <td>{b.period || "—"}</td>
                            <td className="text-slate-500">{b.account_name || b.note || "—"}</td>
                            <td className="text-right font-bold">{fmt(b.amount)} ₺</td>
                            <td className="text-right text-slate-600 font-medium whitespace-nowrap" data-testid={`emp-bonus-paid-on-${b.id}`}>{paidOn ? formatTrDate(paidOn) : "—"}</td>
                            <td className="text-right">
                              <Badge s={b.status} date={paidOn} />
                              {b.type === "yevmiye" && b.status !== "paid" ? (
                                <div className="flex justify-end gap-2 mt-0.5">
                                  <button type="button" className="text-[10px] text-indigo-700 font-semibold" onClick={() => setYevmiyeOpen({ editId: b.id, haveDays: 0, initialDays: String(b.worked_days || ""), initialWage: String(b.daily_wage || e.daily_wage || ""), initialNote: b.note || "" })}>düzenle</button>
                                  <button type="button" className="text-[10px] text-rose-700 font-semibold" data-testid={`emp-yevmiye-row-del-${b.id}`} onClick={async () => { if (!window.confirm("Bu yevmiye kaydı silinsin mi?")) return; try { await axios.delete(`${API_URL}/personnel/bonuses/${b.id}`); toast.success("Yevmiye kaydı silindi."); afterMoney(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }}>sil</button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {tab === "leaves" && (
              <div className="space-y-3"><div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <form
                  className="bg-slate-50 rounded-xl p-3 space-y-1.5"
                  data-testid="emp-leave-annual"
                  onSubmit={(ev) => { ev.preventDefault(); saveAnnualLeave(); }}
                >
                  <div className="text-[10px] uppercase font-semibold text-slate-400">{`Yıllık Hak${card.leave_balance?.year ? ` (${card.leave_balance.year})` : ""}`}</div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      max="365"
                      step="1"
                      value={annualDraft}
                      onChange={(ev) => setAnnualDraft(ev.target.value)}
                      className="w-16 bg-white border border-slate-200 rounded-lg px-1.5 py-1 text-sm font-bold text-slate-900"
                      data-testid="emp-leave-annual-input"
                    />
                    <span className="text-sm font-bold text-slate-900">gün</span>
                    <button
                      type="submit"
                      disabled={annualBusy}
                      className="ml-auto px-2 py-1 rounded-lg text-[10px] font-extrabold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      data-testid="emp-leave-annual-save"
                    >
                      {annualBusy ? "…" : "Kaydet"}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-500">Bu personelin yıllık izin hakkı</div>
                </form>
                <Stat label="Kullanılan" value={`${card.leave_balance.used} gün`} /><Stat label="Devir" value={`${card.leave_balance.carry || 0} gün`} testid="emp-leave-carry" /><Stat label="Kalan" value={`${card.leave_balance.remaining} gün`} testid="emp-leave-remaining" /></div>
                <table className="w-full" data-testid="emp-leaves-table"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Tür</th><th className="text-left">Tarih</th><th className="text-right">Gün</th><th className="text-left pl-3">Açıklama</th><th className="text-right">Durum</th></tr></thead>
                  <tbody className="divide-y">{card.leaves.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">İzin kaydı yok.</td></tr>}{card.leaves.map((l) => <tr key={l.id}><td className="py-1.5 font-semibold">{LEAVE[l.type] || l.type}</td><td>{l.start_date} → {l.end_date}</td><td className="text-right">{l.days}</td><td className="pl-3 text-slate-500">{l.reason}</td><td className="text-right"><Badge s={l.status} /></td></tr>)}</tbody></table></div>
            )}
            {tab === "attendance" && (
              <div className="space-y-3" data-testid="emp-attendance">
                {card.workplace?.kind === "task" ? <div className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg p-2" data-testid="emp-att-workplace">Dış görev: {workplaceShort(card.workplace)} — giriş firma veya görev yerinden</div> : null}
                {isDailyWage(e) ? <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2" data-testid="emp-att-yevmiye">Yevmiye hak ediş: {card.attendance.days_present || 0} gün × {fmt(e.daily_wage)} ₺ = {fmt(periodWage(e, card.attendance.days_present))} ₺</div> : null}
                <EmployeePuantajPanel
                  employeeId={id}
                  initialMonth={card.attendance?.month}
                  onLeaveYearChanged={reload}
                />
              </div>
            )}
            {tab === "pay" && <EmployeeCompensationForm key={card.employee.updated_at || card.employee.id} employee={card.employee} companySchedule={schedule} onSaved={reload} />}
            {tab === "user" && <UserTab card={card} reload={reload} onResetData={() => { setResetOpen(true); setResetOk(false); }} />}
          </>)}
        </div>
      </div>
      {unifyPay && (
        <EmployeePayModal
          employee={e}
          companyId={companyId}
          accounts={accounts}
          card={card}
          onClose={() => setUnifyPay(false)}
          onDone={afterMoney}
        />
      )}
      {taskOpen ? <EmployeeAssignTaskModal employee={e} companyId={companyId} onClose={() => setTaskOpen(false)} onSaved={afterMoney} /> : null}
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
      {termOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); setTermOpen(false); setTermOk(false); })} data-testid="emp-terminate-modal">
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
      {resetOpen && (() => {
        const ask = empDataResetConfirm(e);
        return (
          <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps((ev) => { ev.stopPropagation(); setResetOpen(false); setResetOk(false); })} data-testid="emp-data-reset-modal">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(ev) => ev.stopPropagation()}>
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="text-base font-bold text-rose-800 flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> {ask.title}</h3>
                <button type="button" onClick={() => { setResetOpen(false); setResetOk(false); }} className="text-slate-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="text-xs text-slate-700 space-y-3">
                <p>{ask.message}</p>
                <ul className="list-disc pl-5 space-y-0.5 text-slate-600">
                  <li>Ödemeler (maaş / avans / prim)</li>
                  <li>Masraflar</li>
                  <li>Fazla mesai kayıtları</li>
                  <li>Giriş-çıkış ve puantaj</li>
                </ul>
                <label className="flex items-start gap-2 text-slate-700">
                  <input type="checkbox" checked={resetOk} onChange={(ev) => setResetOk(ev.target.checked)} className="mt-0.5" data-testid="emp-data-reset-confirm-check" />
                  <span>{ask.check}</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={() => { setResetOpen(false); setResetOk(false); }} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button>
                <button type="button" onClick={confirmResetData} disabled={busyReset || !resetOk} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5" data-testid="emp-data-reset-confirm">
                  {busyReset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Sıfırla
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {movesOpen ? (
        <EmployeeMovesModal
          employee={e}
          onClose={() => setMovesOpen(false)}
          onChanged={() => { reload(); onChanged?.(); }}
        />
      ) : null}
    </div>
  );
};
