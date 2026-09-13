
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Users, Plus, ArrowDownRight, ArrowUpRight, PieChart, X, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { PartnerTxTable } from "./PartnerTxTable";
import { CashApprovalsBanner } from "./CashApprovalsBanner";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TX_LABEL = { capital_in: "Sermaye Girişi", withdrawal: "Para Çekişi", profit_share: "Kâr Payı" };

const Modal = ({ title, onClose, children, testId }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid={testId}>
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const PartnersPanel = ({ companyId, accounts, onCashChanged }) => {
  const [partners, setPartners] = useState([]);
  const [summary, setSummary] = useState(null);
  const [txs, setTxs] = useState([]);
  const [modal, setModal] = useState(null); // add | tx | profit
  const [partnerForm, setPartnerForm] = useState({ name: "", share_percent: "", phone: "", email: "" });
  const [txForm, setTxForm] = useState({ partner_id: "", type: "capital_in", amount: "", account_id: "", description: "" });
  const [profitForm, setProfitForm] = useState({ total_profit: "", pay_now: true, account_id: "", period: new Date().toISOString().slice(0, 7) });

  const load = useCallback(async () => {
    try {
      const [p, s, t] = await Promise.all([
        axios.get(`${API_URL}/banking/partners?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/partners/summary?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/partners/transactions?company_id=${companyId}`)
      ]);
      setPartners(p.data); setSummary(s.data); setTxs(t.data);
    } catch { toast.error("Ortak verileri yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const firstAcc = accounts[0]?.id || "";

  const savePartner = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/banking/partners`, { company_id: companyId, ...partnerForm, share_percent: Number(partnerForm.share_percent || 0) });
      toast.success("Ortak eklendi."); setModal(null); setPartnerForm({ name: "", share_percent: "", phone: "", email: "" }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Ortak eklenemedi."); }
  };

  const saveTx = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/banking/partners/transactions`, { ...txForm, amount: Number(txForm.amount), account_id: txForm.account_id || firstAcc });
      if (res.data?.status === "pending_approval") {
        toast.success(res.data.message);
      } else {
        toast.success(txForm.type === "capital_in" ? "Sermaye girişi kaydedildi." : "Para çekişi kaydedildi.");
      }
      setModal(null); setTxForm({ ...txForm, amount: "", description: "" }); load(); onCashChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "İşlem kaydedilemedi."); }
  };

  const distribute = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/banking/partners/distribute-profit`, { company_id: companyId, ...profitForm, total_profit: Number(profitForm.total_profit), account_id: profitForm.account_id || firstAcc });
      toast.success(res.data.message); setModal(null); load(); onCashChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kâr dağıtımı yapılamadı."); }
  };

  const removePartner = async (id) => {
    try { await axios.delete(`${API_URL}/banking/partners/${id}`); toast.success("Ortak silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Ortak silinemedi."); }
  };

  return (
    <div className="space-y-5" data-testid="partners-panel">
      <CashApprovalsBanner companyId={companyId} refreshKey={`${partners.length}-${txs[0]?.id || ""}-${modal || ""}`} onChanged={() => { load(); onCashChanged?.(); }} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600"><Users className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Ortaklar Hesabı</h2>
            <p className="text-xs text-slate-500">Ortak bazlı sermaye giriş/çıkışı ve kâr payı dağıtımı (131/331)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setTxForm({ ...txForm, partner_id: partners[0]?.id || "", account_id: firstAcc }); setModal("tx"); }} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="partner-tx-btn"><ArrowDownRight className="w-4 h-4" /> Para Koy / Çek</button>
          <button onClick={() => { setProfitForm({ ...profitForm, account_id: firstAcc }); setModal("profit"); }} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="distribute-profit-btn"><PieChart className="w-4 h-4" /> Kâr Payı Dağıt</button>
          <button onClick={() => setModal("add")} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="add-partner-btn"><Plus className="w-4 h-4" /> Ortak Ekle</button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[["Toplam Ortak Alacağı", summary.total_balance, "text-amber-700"], ["Toplam Sermaye Girişi", summary.total_capital_in, "text-emerald-700"], ["Toplam Çekilen", summary.total_withdrawn, "text-rose-700"], ["Dağıtılan Kâr", summary.total_profit_share, "text-indigo-700"]].map(([l, v, c]) => (
            <div key={l} className="bg-white border border-slate-200 rounded-xl p-3" data-testid={`partner-summary-${l}`}>
              <div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div>
              <div className={`text-base font-bold ${c}`}>{fmt(v)} ₺</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {partners.map((p) => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-sm" data-testid={`partner-card-${p.name}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                <div className="text-[11px] text-slate-500">{p.email || p.phone || "—"}</div>
              </div>
              <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-2 py-0.5 text-xs font-bold">%{p.share_percent}</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase text-slate-400 font-semibold">Ortak Bakiyesi</div>
                <div className="text-lg font-bold text-slate-900">{fmt(p.balance)} ₺</div>
              </div>
              <button onClick={() => removePartner(p.id)} className="p-1.5 text-slate-300 hover:text-rose-600" title="Sil" data-testid={`delete-partner-${p.name}`}><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-500">
              <div>Giriş: <b className="text-emerald-700">{fmt(p.total_capital_in)}</b></div>
              <div>Çekiş: <b className="text-rose-700">{fmt(p.total_withdrawn)}</b></div>
              <div>Kâr: <b className="text-indigo-700">{fmt(p.total_profit_share)}</b></div>
            </div>
          </div>
        ))}
        {partners.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-6 bg-white border border-dashed rounded-2xl">Henüz ortak tanımlanmadı.</div>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">Ortak Hareketleri</div>
        <PartnerTxTable txs={txs} accounts={accounts} companyId={companyId} onChanged={() => { load(); onCashChanged?.(); }} />
      </div>

      {modal === "add" && (
        <Modal title="Yeni Ortak" onClose={() => setModal(null)} testId="add-partner-modal">
          <form onSubmit={savePartner} className="space-y-3 text-xs">
            <div><label className="block font-semibold mb-1">Ad Soyad</label><input className={inputCls} value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} required data-testid="partner-name-input" /></div>
            <div><label className="block font-semibold mb-1">Ortaklık Payı (%)</label><input type="number" step="0.01" className={inputCls} value={partnerForm.share_percent} onChange={(e) => setPartnerForm({ ...partnerForm, share_percent: e.target.value })} required data-testid="partner-share-input" />
              <p className="text-[10px] text-slate-400 mt-1">Mevcut toplam: %{summary?.total_share_percent || 0}</p></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block font-semibold mb-1">Telefon</label><input className={inputCls} value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} /></div>
              <div><label className="block font-semibold mb-1">E-posta</label><input className={inputCls} value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-partner-btn">Kaydet</button></div>
          </form>
        </Modal>
      )}

      {modal === "tx" && (
        <Modal title="Ortak Para Koy / Çek" onClose={() => setModal(null)} testId="partner-tx-modal">
          <form onSubmit={saveTx} className="space-y-3 text-xs">
            <div><label className="block font-semibold mb-1">Ortak</label><select className={inputCls} value={txForm.partner_id} onChange={(e) => setTxForm({ ...txForm, partner_id: e.target.value })} data-testid="partner-tx-partner-select">{partners.map((p) => <option key={p.id} value={p.id}>{p.name} (%{p.share_percent})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "capital_in" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "capital_in" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="partner-tx-type-in"><ArrowDownRight className="w-4 h-4" /> Para Koy</button>
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "withdrawal" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "withdrawal" ? "bg-rose-600 text-white border-rose-600" : "bg-white"}`} data-testid="partner-tx-type-out"><ArrowUpRight className="w-4 h-4" /> Para Çek</button>
            </div>
            <div><label className="block font-semibold mb-1">Kasa / Banka / Kart</label><PaymentTargetSelect companyId={companyId} accounts={accounts} value={txForm.account_id} onChange={(v) => setTxForm({ ...txForm, account_id: v })} testId="partner-tx-account-select" includePartners={false} className={inputCls} /></div>
            <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required data-testid="partner-tx-amount-input" /></div>
            <div><label className="block font-semibold mb-1">Açıklama</label><input className={inputCls} value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Örn: Sermaye artırımı" /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-partner-tx-btn">İşlemi Kaydet</button></div>
          </form>
        </Modal>
      )}

      {modal === "profit" && (
        <Modal title="Kâr Payı Dağıtımı" onClose={() => setModal(null)} testId="distribute-profit-modal">
          <form onSubmit={distribute} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block font-semibold mb-1">Dönem</label><input type="month" className={inputCls} value={profitForm.period} onChange={(e) => setProfitForm({ ...profitForm, period: e.target.value })} /></div>
              <div><label className="block font-semibold mb-1">Dağıtılacak Kâr (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={profitForm.total_profit} onChange={(e) => setProfitForm({ ...profitForm, total_profit: e.target.value })} required data-testid="profit-amount-input" /></div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1">
              {partners.map((p) => <div key={p.id} className="flex justify-between"><span>{p.name} (%{p.share_percent})</span><b>{fmt(Number(profitForm.total_profit || 0) * p.share_percent / (summary?.total_share_percent || 100))} ₺</b></div>)}
            </div>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={profitForm.pay_now} onChange={(e) => setProfitForm({ ...profitForm, pay_now: e.target.checked })} data-testid="profit-pay-now-checkbox" /><span className="font-semibold">Hemen öde (kasadan/bankadan çık) — kapalıysa ortak alacağı olarak tahakkuk eder</span></label>
            {profitForm.pay_now && <div><label className="block font-semibold mb-1">Kaynak Hesap</label><PaymentTargetSelect companyId={companyId} accounts={accounts} value={profitForm.account_id} onChange={(v) => setProfitForm({ ...profitForm, account_id: v })} testId="profit-account-select" includePartners={false} className={inputCls} /></div>}
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-amber-500 text-white rounded-lg font-semibold" data-testid="confirm-distribute-btn">Dağıt</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};
