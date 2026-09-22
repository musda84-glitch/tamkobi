
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Camera, Users, Plus, ArrowDownRight, ArrowUpRight, ArrowLeftRight, PieChart, X, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { PartnerTxTable } from "./PartnerTxTable";
import { CashApprovalsBanner } from "./CashApprovalsBanner";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { formatTrAmount } from "../utils/money";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";

const fmt = (n) => formatTrAmount((n || 0));
const TX_LABEL = { capital_in: "Sermaye Girişi", withdrawal: "Para Çekişi", profit_share: "Kâr Payı" };

const bal = (a) => Number(a?.current_balance ?? a?.balance ?? 0);
const accId = (a) => a?.id || a?._id || "";
const accLabel = (a) => {
  const name = a?.account_name || a?.name || "Hesap";
  const bank = a?.bank_name && a.bank_name !== name ? a.bank_name : "";
  return `${bank ? `${bank} — ` : ""}${name} · ${fmt(bal(a))} ₺`;
};
const isCard = (a) => String(a?.type || "") === "credit_card";
const isIntegrated = (a) => !!(a?.is_integrated);

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
  const [modal, setModal] = useState(null); // add | tx | profit | virman
  const [liveAccounts, setLiveAccounts] = useState(() => accounts || []);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ name: "", share_percent: "", phone: "", email: "" });
  const [txForm, setTxForm] = useState({ partner_id: "", type: "capital_in", amount: "", account_id: "", description: "" });
  const [profitForm, setProfitForm] = useState({ total_profit: "", pay_now: true, account_id: "", period: new Date().toISOString().slice(0, 7) });
  const [virmanForm, setVirmanForm] = useState({ source_account_id: "", target_account_id: "", amount: "", description: "Hesaplar arası transfer (Virman)" });

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
  useEffect(() => { setLiveAccounts(accounts || []); }, [accounts]);
  useDataRefresh(load, { companyId, scopes: ["cash"] });

  const bumpCash = useCallback(async () => {
    await notifyDataChanged({ companyId, scopes: ["cash"] });
  }, [companyId]);

  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const r = await axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`);
      const list = Array.isArray(r.data) ? r.data : [];
      setLiveAccounts(list);
      return list;
    } catch {
      toast.error("Kasa / banka listesi yenilenemedi.");
      return liveAccounts;
    } finally {
      setAccountsLoading(false);
    }
  }, [companyId, liveAccounts]);

  const cashAccounts = liveAccounts.filter((a) => !isCard(a));
  // Virman: kredi kartları + ortaklar (UI); entegre hesaplar hariç.
  const transferAccounts = liveAccounts.filter((a) => !isIntegrated(a));
  const firstAcc = accId(cashAccounts[0]) || accId(liveAccounts[0]) || "";

  const openTxModal = async () => {
    const list = await refreshAccounts();
    const cash = list.filter((a) => !isCard(a));
    setTxForm({ partner_id: partners[0]?.id || "", type: "capital_in", amount: "", account_id: accId(cash[0]) || accId(list[0]) || "", description: "" });
    setModal("tx");
  };

  const openProfitModal = async () => {
    const list = await refreshAccounts();
    const cash = list.filter((a) => !isCard(a));
    setProfitForm({ total_profit: "", pay_now: true, account_id: accId(cash[0]) || accId(list[0]) || "", period: new Date().toISOString().slice(0, 7) });
    setModal("profit");
  };

  const openVirmanModal = async () => {
    const list = await refreshAccounts();
    const eligible = list.filter((a) => !isIntegrated(a));
    const activePartners = partners.filter((p) => p.is_active !== false);
    const first = accId(eligible[0]) || (activePartners[0] ? `partner:${activePartners[0].id}` : "");
    const second = accId(eligible[1])
      || (activePartners[1] ? `partner:${activePartners[1].id}` : "")
      || (activePartners[0] ? `partner:${activePartners[0].id}` : "")
      || accId(eligible[0])
      || first;
    setVirmanForm({
      source_account_id: first,
      target_account_id: second !== first ? second : (accId(eligible[0]) || first),
      amount: "",
      description: "Hesaplar arası transfer (Virman)",
    });
    setModal("virman");
  };

  const saveVirman = async (e) => {
    e.preventDefault();
    if (!virmanForm.amount || Number(virmanForm.amount) <= 0) {
      toast.error("Geçerli bir tutar giriniz.");
      return;
    }
    if (virmanForm.source_account_id === virmanForm.target_account_id) {
      toast.error("Kaynak ve hedef hesap aynı olamaz.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/banking/virman`, {
        company_id: companyId,
        source_account_id: virmanForm.source_account_id,
        target_account_id: virmanForm.target_account_id,
        amount: Number(virmanForm.amount),
        description: virmanForm.description,
      });
      if (res.data?.status === "pending_approval") toast.success(res.data.message);
      else toast.success(res.data?.message || "Virman tamamlandı.");
      setModal(null);
      setVirmanForm({ ...virmanForm, amount: "" });
      await refreshAccounts();
      await bumpCash();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Virman işlemi gerçekleştirilemedi.");
    }
  };

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
      setModal(null); setTxForm({ ...txForm, amount: "", description: "" }); load(); await bumpCash();
    } catch (err) { toast.error(err.response?.data?.detail || "İşlem kaydedilemedi."); }
  };

  const distribute = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/banking/partners/distribute-profit`, { company_id: companyId, ...profitForm, total_profit: Number(profitForm.total_profit), account_id: profitForm.account_id || firstAcc });
      toast.success(res.data.message); setModal(null); load(); await bumpCash();
    } catch (err) { toast.error(err.response?.data?.detail || "Kâr dağıtımı yapılamadı."); }
  };

  const removePartner = async (id) => {
    try { await axios.delete(`${API_URL}/banking/partners/${id}`); toast.success("Ortak silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Ortak silinemedi."); }
  };

  const uploadPartnerPhoto = async (partnerId, ev) => {
    const raw = ev.target.files?.[0];
    ev.target.value = "";
    if (!raw || !partnerId) return;
    try {
      const file = await compressImageFile(raw);
      const fd = new FormData();
      fd.append("file", file);
      const r = await axios.post(
        `${API_URL}/files/upload?entity=partner_photo&entity_id=${encodeURIComponent(partnerId)}&company_id=${encodeURIComponent(companyId || "")}`,
        fd,
      );
      toast.success(r.data?.saved_pct ? `Fotoğraf yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fotoğraf yüklendi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi.");
    }
  };

  return (
    <div className="space-y-5" data-testid="partners-panel">
      <CashApprovalsBanner companyId={companyId} refreshKey={`${partners.length}-${txs[0]?.id || ""}-${modal || ""}`} onChanged={() => { load(); bumpCash(); }} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600"><Users className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Ortaklar Hesabı</h2>
            <p className="text-xs text-slate-500">Ortak bazlı sermaye giriş/çıkışı ve kâr payı dağıtımı (131/331)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={openTxModal} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="partner-tx-btn"><ArrowDownRight className="w-4 h-4" /> Para Koy / Çek</button>
          <button onClick={openVirmanModal} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="partner-virman-btn"><ArrowLeftRight className="w-4 h-4" /> Virman</button>
          <button onClick={openProfitModal} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="distribute-profit-btn"><PieChart className="w-4 h-4" /> Kâr Payı Dağıt</button>
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
              <div className="flex items-start gap-3 min-w-0">
                <label
                  className="relative w-12 h-12 rounded-full shrink-0 cursor-pointer group"
                  title="Fotoğraf yükle"
                  data-testid={`partner-photo-${p.id}`}
                >
                  {p.photo_url ? (
                    <img src={resolveImageUrl(p.photo_url)} alt="" className="w-12 h-12 rounded-full object-cover bg-white border border-slate-200" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-sm">{(p.name || "O").slice(0, 2).toUpperCase()}</div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center shadow-sm group-hover:bg-slate-900">
                    <Camera className="w-3 h-3" />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(ev) => uploadPartnerPhoto(p.id, ev)}
                    data-testid={`partner-photo-input-${p.id}`}
                  />
                </label>
                <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                <div className="text-[11px] text-slate-500">{p.email || p.phone || "—"}</div>
                </div>
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
        <PartnerTxTable txs={txs} accounts={liveAccounts} companyId={companyId} onChanged={() => { load(); bumpCash(); }} />
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
            <div><label className="block font-semibold mb-1">{txForm.type === "capital_in" ? "Kasa / Banka Hesabı" : "Kasa / Banka / Kart"}</label><PaymentTargetSelect companyId={companyId} accounts={liveAccounts} value={txForm.account_id} onChange={(v) => setTxForm({ ...txForm, account_id: v })} testId="partner-tx-account-select" includePartners={false} collectableOnly={txForm.type === "capital_in"} disabled={accountsLoading} emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined} className={inputCls} /></div>
            <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required data-testid="partner-tx-amount-input" /></div>
            <div><label className="block font-semibold mb-1">Açıklama</label><input className={inputCls} value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Örn: Sermaye artırımı" /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-partner-tx-btn">İşlemi Kaydet</button></div>
          </form>
        </Modal>
      )}


      {modal === "virman" && (
        <Modal title="Hesaplar Arası Virman" onClose={() => setModal(null)} testId="partner-virman-modal">
          <form onSubmit={saveVirman} className="space-y-3 text-xs">
            <p className="text-[11px] text-slate-500">Kasa, banka, POS, kredi kartı ve ortaklar arasında transfer. Hesap→ortak para çekişi, ortak→hesap sermaye girişi olarak işlenir; entegre hesaplar listelenmez.</p>
            <div>
              <label className="block font-semibold mb-1">Kaynak Hesap (Çıkış)</label>
              <PaymentTargetSelect
                companyId={companyId}
                accounts={liveAccounts}
                value={virmanForm.source_account_id}
                onChange={(v) => setVirmanForm({ ...virmanForm, source_account_id: v })}
                testId="partner-virman-source"
                includePartners
                excludeIntegrated
                disabled={accountsLoading}
                emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Hedef Hesap (Giriş)</label>
              <PaymentTargetSelect
                companyId={companyId}
                accounts={liveAccounts}
                value={virmanForm.target_account_id}
                onChange={(v) => setVirmanForm({ ...virmanForm, target_account_id: v })}
                testId="partner-virman-target"
                includePartners
                excludeIntegrated
                disabled={accountsLoading}
                emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined}
                className={inputCls}
              />
            </div>
            <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={virmanForm.amount} onChange={(e) => setVirmanForm({ ...virmanForm, amount: e.target.value })} required data-testid="partner-virman-amount" /></div>
            <div><label className="block font-semibold mb-1">Açıklama</label><input className={inputCls} value={virmanForm.description} onChange={(e) => setVirmanForm({ ...virmanForm, description: e.target.value })} data-testid="partner-virman-desc" /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" disabled={accountsLoading || (transferAccounts.length + partners.filter((p) => p.is_active !== false).length) < 2 || virmanForm.source_account_id === virmanForm.target_account_id} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="partner-virman-submit">Virmanı Onayla</button></div>
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
            {profitForm.pay_now && <div><label className="block font-semibold mb-1">Kaynak Hesap</label><PaymentTargetSelect companyId={companyId} accounts={liveAccounts} value={profitForm.account_id} onChange={(v) => setProfitForm({ ...profitForm, account_id: v })} testId="profit-account-select" includePartners={false} disabled={accountsLoading} emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined} className={inputCls} /></div>}
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-amber-500 text-white rounded-lg font-semibold" data-testid="confirm-distribute-btn">Dağıt</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};
