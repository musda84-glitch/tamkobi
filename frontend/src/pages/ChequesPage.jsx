
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ScrollText, Plus, Trash2, X, Landmark, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { ExportButtons } from "../components/ExportButtons";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-emerald-500 outline-none";
const todayISO = () => new Date().toISOString().slice(0, 10);

const INST = { cheque: "Çek", promissory: "Senet" };
const DIR = { received: "Alınan", issued: "Verilen" };
const STATUS_CLS = {
  open: "bg-amber-50 text-amber-800",
  collected: "bg-emerald-50 text-emerald-700",
  paid: "bg-emerald-50 text-emerald-700",
  endorsed: "bg-indigo-50 text-indigo-700",
  bounced: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const Stat = ({ label, value, cls = "", testid }) => (
  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4">
    <div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div>
    <div className={`text-lg font-bold ${cls}`} data-testid={testid}>{value}</div>
  </div>
);

const ChequeModal = ({ companyId, contacts, onClose, onSaved }) => {
  useEscape(onClose);
  const [d, setD] = useState({
    direction: "received", instrument: "cheque", contact_id: "", amount: "",
    issue_date: todayISO(), due_date: todayISO(), serial_no: "", bank_name: "", bank_branch: "", account_no: "", drawer_name: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API_URL}/cheques`, { ...d, company_id: companyId, amount: Number(d.amount) });
      toast.success("Çek/senet kaydedildi; cari bakiyesi güncellendi.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="cheque-modal">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-bold flex items-center gap-2"><ScrollText className="w-5 h-5 text-teal-600" /> Yeni Çek / Senet</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">Yön</label>
            <select value={d.direction} onChange={(e) => setD({ ...d, direction: e.target.value })} className={inputCls} data-testid="cheque-direction">
              <option value="received">Alınan (müşteriden)</option>
              <option value="issued">Verilen (tedarikçiye)</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Tür</label>
            <select value={d.instrument} onChange={(e) => setD({ ...d, instrument: e.target.value })} className={inputCls} data-testid="cheque-instrument">
              <option value="cheque">Çek</option>
              <option value="promissory">Senet</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block font-semibold mb-1">Cari</label>
            <select required value={d.contact_id} onChange={(e) => setD({ ...d, contact_id: e.target.value })} className={inputCls} data-testid="cheque-contact">
              <option value="">Seçin…</option>
              {contacts.map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Tutar (₺)</label>
            <input type="number" step="0.01" min="0.01" required value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} className={`${inputCls} font-bold`} data-testid="cheque-amount" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Çek / Senet No</label>
            <input value={d.serial_no} onChange={(e) => setD({ ...d, serial_no: e.target.value })} className={inputCls} data-testid="cheque-serial" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Keşide Tarihi</label>
            <input type="date" value={d.issue_date} onChange={(e) => setD({ ...d, issue_date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Vade</label>
            <input type="date" required value={d.due_date} onChange={(e) => setD({ ...d, due_date: e.target.value })} className={inputCls} data-testid="cheque-due" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Banka</label>
            <input value={d.bank_name} onChange={(e) => setD({ ...d, bank_name: e.target.value })} className={inputCls} placeholder="Örn: Garanti BBVA" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Şube</label>
            <input value={d.bank_branch} onChange={(e) => setD({ ...d, bank_branch: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Hesap / IBAN (opsiyonel)</label>
            <input value={d.account_no} onChange={(e) => setD({ ...d, account_no: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Keşideci</label>
            <input value={d.drawer_name} onChange={(e) => setD({ ...d, drawer_name: e.target.value })} className={inputCls} placeholder="Boşsa cari adı" />
          </div>
          <div className="col-span-2">
            <label className="block font-semibold mb-1">Not</label>
            <input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className={inputCls} />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Alınan kayıt carinin alacağını düşer (portföye alınır). Verilen kayıt tedarikçi borcunu kapatır. Bankaya tahsil/ödeme ayrıca işlenir.</p>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40" data-testid="cheque-save">Kaydet</button>
        </div>
      </form>
    </div>
  );
};

const ActionModal = ({ kind, row, accounts, contacts, companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [accountId, setAccountId] = useState(accounts[0]?.id || accounts[0]?._id || "");
  const [contactId, setContactId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const titles = { collect: "Tahsil et", pay: "Öde", endorse: "Ciro et", bounce: "Karşılıksız" };
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const id = row.id;
      if (kind === "collect") await axios.post(`${API_URL}/cheques/${id}/collect`, { ...splitPaymentTarget(accountId) });
      if (kind === "pay") await axios.post(`${API_URL}/cheques/${id}/pay`, { ...splitPaymentTarget(accountId) });
      if (kind === "endorse") await axios.post(`${API_URL}/cheques/${id}/endorse`, { contact_id: contactId });
      if (kind === "bounce") await axios.post(`${API_URL}/cheques/${id}/bounce`, { reason });
      toast.success("İşlem tamam.");
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem yapılamadı.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={run} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 shadow-2xl" data-testid="cheque-action-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold">{titles[kind]} · {row.number} · {fmt(row.amount)} ₺</h3>
          <button type="button" onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        {(kind === "collect" || kind === "pay") && (
          <div className="text-xs">
            <label className="block font-semibold mb-1">Hesap</label>
            <PaymentTargetSelect companyId={companyId} accounts={accounts} value={accountId} onChange={setAccountId} testId="cheque-action-account" emptyLabel="Hesap seçin" collectableOnly={kind === "collect"} />
          </div>
        )}
        {kind === "endorse" && (
          <div className="text-xs">
            <label className="block font-semibold mb-1">Ciro edilecek cari</label>
            <select required value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls} data-testid="cheque-endorse-contact">
              <option value="">Seçin…</option>
              {contacts.filter((c) => (c.id || c._id) !== row.contact_id).map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {kind === "bounce" && (
          <div className="text-xs">
            <label className="block font-semibold mb-1">Açıklama</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Karşılıksız / protesto" data-testid="cheque-bounce-reason" />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold" data-testid="cheque-action-submit">Onayla</button>
        </div>
      </form>
    </div>
  );
};

export default function ChequesPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState({ cheques: [], summary: null });
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");
  const [modal, setModal] = useState(false);
  const [action, setAction] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQLive(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ company_id: companyId });
    if (tab === "received" || tab === "issued") params.set("direction", tab);
    if (tab === "open") params.set("status", "open");
    if (qLive.trim()) params.set("q", qLive.trim());
    const [c, ct, acc] = await Promise.all([
      axios.get(`${API_URL}/cheques?${params}`),
      axios.get(`${API_URL}/contacts?company_id=${companyId}`).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).catch(() => ({ data: [] })),
    ]);
    setData(c.data);
    setContacts(ct.data || []);
    setAccounts((acc.data || []));
  }, [companyId, tab, qLive]);

  useEffect(() => { load().catch(() => toast.error("Çek/senet listesi yüklenemedi.")); }, [load]);
  const refreshSilent = useCallback(() => load(), [load]);
  useDataRefresh(refreshSilent, { companyId, scopes: ["cash", "contacts"] });

  const cancel = async (row) => {
    if (!window.confirm(`${row.number} iptal edilsin mi? Cari bakiyesi geri alınır.`)) return;
    try { await axios.post(`${API_URL}/cheques/${row.id}/cancel`, {}); toast.success("İptal edildi."); await notifyDataChanged({ companyId, scopes: ["cash", "contacts"] }); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "İptal edilemedi."); }
  };
  const del = async (row) => {
    if (!window.confirm(`${row.number} silinsin mi?`)) return;
    try { await axios.delete(`${API_URL}/cheques/${row.id}`); toast.success("Çöp kutusuna taşındı."); await notifyDataChanged({ companyId, scopes: ["cash", "contacts"] }); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };

  const s = data.summary;
  const rows = tab === "overdue" ? data.cheques.filter((r) => r.overdue) : data.cheques;
  const COLS = [
    { key: "number", label: "No" },
    { label: "Tür", value: (r) => `${DIR[r.direction] || r.direction} ${INST[r.instrument] || r.instrument}` },
    { key: "contact_name", label: "Cari" },
    { key: "serial_no", label: "Çek/Senet No" },
    { key: "due_date", label: "Vade" },
    { key: "amount", label: "Tutar", num: true },
    { key: "status_label", label: "Durum" },
  ];

  return (
    <div className="space-y-6" data-testid="cheques-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Çek / Senet</h1>
          <p className="text-xs sm:text-sm text-slate-500">Alınan ve verilen çek-senet girişi, vade takibi, tahsil, ciro ve karşılıksız</p>
        </div>
        <div className="flex gap-2 self-start">
          <ExportButtons rows={rows} columns={COLS} filename="cek-senet" title="Çek / Senet Listesi" size="md" />
          <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md" data-testid="cheque-new-btn">
            <Plus className="w-4 h-4" /> Yeni Giriş
          </button>
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Portföy (Alınan Açık)" value={`${fmt(s.portfolio)} ₺`} cls="text-emerald-700" testid="cheque-stat-portfolio" />
          <Stat label="Verilen Açık" value={`${fmt(s.issued_open)} ₺`} cls="text-rose-600" testid="cheque-stat-issued" />
          <Stat label="7 Gün İçinde Vade" value={`${fmt(s.due_this_week)} ₺`} cls="text-amber-600" testid="cheque-stat-week" />
          <Stat label="Karşılıksız" value={`${fmt(s.bounced)} ₺`} cls={s.bounced ? "text-rose-600" : ""} testid="cheque-stat-bounced" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {[["all", "Tümü"], ["received", "Alınan"], ["issued", "Verilen"], ["open", "Açık"], ["overdue", "Vadesi geçmiş"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${tab === k ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200"}`} data-testid={`cheque-tab-${k}`}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="No, cari, banka ara…" className="ml-auto bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-48" data-testid="cheque-search" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold">
              <tr>
                <th className="px-3 py-2.5">No</th>
                <th className="px-3 py-2.5">Yön / Tür</th>
                <th className="px-3 py-2.5">Cari</th>
                <th className="px-3 py-2.5">Vade</th>
                <th className="px-3 py-2.5">Banka / Seri</th>
                <th className="px-3 py-2.5 text-right">Tutar</th>
                <th className="px-3 py-2.5">Durum</th>
                <th className="px-3 py-2.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400" data-testid="cheques-empty">Kayıt yok. “Yeni Giriş” ile alınan veya verilen çek/senet ekleyin.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={r.overdue ? "bg-rose-50/40" : ""} data-testid={`cheque-row-${r.id}`}>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-800">{r.number}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 ${r.direction === "received" ? "text-emerald-700" : "text-rose-700"}`}>
                      {r.direction === "received" ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                      {DIR[r.direction]} {INST[r.instrument]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{r.contact_name}</td>
                  <td className={`px-3 py-2 font-mono ${r.overdue ? "text-rose-700 font-bold" : ""}`}>{r.due_date}</td>
                  <td className="px-3 py-2 text-slate-500">{r.bank_name || "—"}{r.serial_no ? ` · ${r.serial_no}` : ""}</td>
                  <td className="px-3 py-2 text-right font-bold">{fmt(r.amount)} ₺</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CLS[r.status] || "bg-slate-100"}`}>{r.status_label}</span></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status === "open" && r.direction === "received" && (
                      <>
                        <button onClick={() => setAction({ kind: "collect", row: r })} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md mr-1" data-testid={`cheque-collect-${r.id}`}>Tahsil</button>
                        <button onClick={() => setAction({ kind: "endorse", row: r })} className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md mr-1" data-testid={`cheque-endorse-${r.id}`}>Ciro</button>
                      </>
                    )}
                    {r.status === "open" && r.direction === "issued" && (
                      <button onClick={() => setAction({ kind: "pay", row: r })} className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md mr-1" data-testid={`cheque-pay-${r.id}`}>Öde</button>
                    )}
                    {(r.status === "open" || r.status === "collected" || r.status === "paid" || r.status === "endorsed") && (
                      <button onClick={() => setAction({ kind: "bounce", row: r })} className="text-[10px] font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-md mr-1" data-testid={`cheque-bounce-${r.id}`}>Karşılıksız</button>
                    )}
                    {r.status === "open" && (
                      <button onClick={() => cancel(r)} className="text-[10px] font-semibold text-slate-600 mr-1" data-testid={`cheque-cancel-${r.id}`}>İptal</button>
                    )}
                    {(r.status === "open" || r.status === "cancelled" || r.status === "bounced") && (
                      <button onClick={() => del(r)} className="p-1 text-slate-400 hover:text-rose-600" data-testid={`cheque-del-${r.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 flex items-center gap-1"><Landmark className="w-3 h-3" /> Tahsil alınan çekleri kasaya/bankaya yatırır; ödeme verilen çekin bedelini hesaptan düşer. Ciro, çeki başka bir cariye (tedarikçi ödemesi) devreder.</p>
      {modal && <ChequeModal companyId={companyId} contacts={contacts} onClose={() => setModal(false)} onSaved={load} />}
      {action && <ActionModal kind={action.kind} row={action.row} accounts={accounts} contacts={contacts} companyId={companyId} onClose={() => setAction(null)} onDone={load} />}
    </div>
  );
}
