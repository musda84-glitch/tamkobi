
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { TrendingUp, Percent, Save, AlertTriangle, Loader2, Wallet } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { channelTr } from "../utils/labels";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1 text-xs w-20";

const FeeEditor = ({ ch, onSaved }) => {
  const [f, setF] = useState(ch.fee_settings);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!ch.channel_id) { toast.error("Bu kanal için entegrasyon kaydı yok."); return; }
    setBusy(true);
    try { await axios.put(`${API_URL}/integrations/ecommerce/${ch.channel_id}/fees`, f); toast.success(`${channelTr(ch.channel)} komisyon ayarları kaydedildi.`); onSaved(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 text-[10px] text-slate-500" data-testid={`fee-editor-${ch.channel}`}>
      <label>Komisyon %<br /><input type="number" step="0.1" value={f.commission_rate} onChange={(e) => setF({ ...f, commission_rate: Number(e.target.value) })} className={inp} data-testid={`fee-commission-${ch.channel}`} /></label>
      <label>Kom. KDV %<br /><input type="number" step="1" value={f.commission_vat_rate} onChange={(e) => setF({ ...f, commission_vat_rate: Number(e.target.value) })} className={inp} data-testid={`fee-vat-${ch.channel}`} /></label>
      <label>Hizmet ₺/sip.<br /><input type="number" step="0.01" value={f.service_fee} onChange={(e) => setF({ ...f, service_fee: Number(e.target.value) })} className={inp} data-testid={`fee-service-${ch.channel}`} /></label>
      <label>Kargo ₺/sip.<br /><input type="number" step="0.01" value={f.cargo_fee} onChange={(e) => setF({ ...f, cargo_fee: Number(e.target.value) })} className={inp} data-testid={`fee-cargo-${ch.channel}`} /></label>
      <button onClick={save} disabled={busy} className="flex items-center gap-1 px-2 py-1.5 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50" data-testid={`fee-save-${ch.channel}`}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Kaydet</button>
    </div>
  );
};

const SettlementAccount = ({ ch, accounts, onSaved }) => {
  const [v, setV] = useState(ch.settlement_account_id || "");
  const [busy, setBusy] = useState(false);
  const save = async (val) => {
    if (!ch.channel_id) { toast.error("Bu kanal için entegrasyon kaydı yok."); return; }
    setV(val); setBusy(true);
    try { const r = await axios.put(`${API_URL}/integrations/ecommerce/${ch.channel_id}/settlement-account`, { account_id: val || null }); toast.success(r.data.message); onSaved(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); setV(ch.settlement_account_id || ""); } finally { setBusy(false); }
  };
  return (
    <div className="border-t pt-2 space-y-1" data-testid={`settlement-${ch.channel}`}>
      <div className="flex items-center gap-1 text-[10px] text-slate-400"><Wallet className="w-3 h-3" /> Hakediş / Ödeme Hesabı — faturalanan sipariş net tutarı (ciro − komisyon − hizmet/kargo) bu hesaba tahsilat, kesintiler "Pazaryeri Komisyonu" masrafı olur</div>
      <div className="flex items-center gap-2">
        <select value={v} onChange={(e) => save(e.target.value)} disabled={busy} className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs flex-1" data-testid={`settlement-select-${ch.channel}`}>
          <option value="">Hesap seçilmedi (yalnızca "ödendi" işaretle)</option>
          {accounts.filter((a) => a.type !== "credit_card").map((a) => <option key={a.id} value={a.id} disabled={a.is_integrated}>{a.account_name}{a.is_integrated ? " (entegre — seçilemez)" : ""}</option>)}
        </select>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        {ch.settlement_account_name && !busy && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded" data-testid={`settlement-active-${ch.channel}`}>Aktif</span>}
      </div>
    </div>
  );
};

export const ProfitabilityPanel = ({ companyId }) => {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const load = useCallback(() => axios.get(`${API_URL}/marketplace/profitability?company_id=${companyId}&days=${days}`).then((r) => setD(r.data)).catch(() => toast.error("Kârlılık yüklenemedi.")), [companyId, days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => setAccounts(r.data)).catch(() => {}); }, [companyId]);
  if (!d) return <div className="p-6 text-xs text-slate-400">Yükleniyor…</div>;
  const t = d.total;
  const tone = (m) => (m < 10 ? "text-rose-600" : m < 20 ? "text-amber-600" : "text-emerald-600");
  return (
    <div className="space-y-4" data-testid="profitability-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" /> Pazaryeri Komisyon & Kârlılık</h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-white border rounded-lg p-1.5 text-xs" data-testid="profit-days">{[7, 30, 90, 365].map((n) => <option key={n} value={n}>{`Son ${n} gün`}</option>)}</select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[["Sipariş", t.orders, ""], ["Ciro (KDV dahil)", `${fmt(t.revenue)} ₺`, ""], ["Komisyon + KDV", `${fmt(t.commission)} ₺`, "text-rose-600"], ["Net Kâr", `${fmt(t.net_profit)} ₺ · %${t.margin_pct}`, tone(t.margin_pct)]].map(([l, v, c]) => <div key={l} className="bg-white border border-slate-200 rounded-2xl p-3" data-testid={`profit-total-${l.split(" ")[0].toLowerCase()}`}><div className="text-[10px] uppercase text-slate-400 font-semibold">{l}</div><div className={`text-base font-bold ${c || "text-slate-900"}`}>{v}</div></div>)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {d.channels.map((ch) => (
          <div key={ch.channel} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs" data-testid={`profit-channel-${ch.channel}`}>
            <div className="flex items-center justify-between"><b className="text-sm text-slate-900">{channelTr(ch.channel)}</b><span className={`font-bold ${tone(ch.margin_pct)}`}>Net %{ch.margin_pct}</span></div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div><div className="text-slate-400">Sipariş</div><b>{ch.orders}</b></div><div><div className="text-slate-400">Ciro</div><b>{fmt(ch.revenue)} ₺</b></div><div><div className="text-slate-400">Komisyon</div><b className="text-rose-600">−{fmt(ch.commission)} ₺</b></div>
              <div><div className="text-slate-400">Hizmet/Kargo</div><b className="text-rose-600">−{fmt(ch.fees)} ₺</b></div><div><div className="text-slate-400">Ürün maliyeti</div><b className="text-rose-600">−{fmt(ch.product_cost)} ₺</b></div><div><div className="text-slate-400">Net kâr</div><b className={tone(ch.margin_pct)}>{fmt(ch.net_profit)} ₺</b></div>
            </div>
            <div className="border-t pt-2 flex items-center gap-1 text-[10px] text-slate-400"><Percent className="w-3 h-3" /> Kanal ücretleri (sipariş bazında hesaplanır)</div>
            <FeeEditor ch={ch} onSaved={load} />
            <SettlementAccount ch={ch} accounts={accounts} onSaved={load} />
          </div>))}
      </div>
      {d.settlement?.count > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs flex flex-wrap gap-4" data-testid="settlement-summary"><b className="text-emerald-900 flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Hakediş (son {days} gün): {d.settlement.count} sipariş</b><span>Brüt <b>{fmt(d.settlement.gross)} ₺</b></span><span>Kesinti <b className="text-rose-600">−{fmt(d.settlement.deductions)} ₺</b></span><span>Hesaba geçen net <b className="text-emerald-700">{fmt(d.settlement.net)} ₺</b></span></div>}
      {d.low_margin.length > 0 && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs" data-testid="profit-low-margin"><div className="font-bold text-amber-800 flex items-center gap-1.5 mb-1"><AlertTriangle className="w-4 h-4" /> Düşük marjlı siparişler (%10 altı) — {d.low_margin.length}</div><div className="flex flex-wrap gap-1.5">{d.low_margin.map((r) => <span key={r.id} className="bg-white border border-amber-200 rounded-lg px-2 py-1">{r.order_number} · {channelTr(r.channel)} · <b className="text-rose-600">%{r.margin_pct}</b></span>)}</div></div>}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b font-bold text-sm">Sipariş Bazlı Kârlılık</div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Sipariş</th><th className="px-3 py-2 text-left">Kanal</th><th className="px-3 py-2 text-right">Ciro</th><th className="px-3 py-2 text-right">KDV</th><th className="px-3 py-2 text-right">Komisyon</th><th className="px-3 py-2 text-right">Hizmet+Kargo</th><th className="px-3 py-2 text-right">Maliyet</th><th className="px-3 py-2 text-right">Net Kâr</th><th className="px-3 py-2 text-right">Marj</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.orders.map((r) => <tr key={r.id} data-testid={`profit-row-${r.order_number}`}><td className="px-3 py-1.5 font-mono font-semibold">{r.order_number}{r.cost_missing_items > 0 && <span className="ml-1 text-[9px] text-amber-600" title="Ürün alış fiyatı tanımsız">maliyet?</span>}</td><td className="px-3 py-1.5">{channelTr(r.channel)}</td><td className="px-3 py-1.5 text-right">{fmt(r.revenue)}</td><td className="px-3 py-1.5 text-right text-slate-400">−{fmt(r.sale_vat)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.commission + r.commission_vat)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.service_fee + r.cargo_fee)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.product_cost)}</td><td className={`px-3 py-1.5 text-right font-bold ${tone(r.margin_pct)}`}>{fmt(r.net_profit)}</td><td className={`px-3 py-1.5 text-right font-bold ${tone(r.margin_pct)}`}>%{r.margin_pct}</td></tr>)}</tbody></table></div>
        {d.orders.length === 0 && <div className="p-8 text-center text-xs text-slate-400">Bu dönemde pazaryeri siparişi yok.</div>}
      </div>
      {d.top_products.length > 0 && <div className="bg-white border border-slate-200 rounded-2xl p-4 text-xs"><div className="font-bold text-sm mb-2">En Kârlı Ürünler (brüt)</div><div className="grid grid-cols-1 md:grid-cols-2 gap-1">{d.top_products.map((p) => <div key={p.product_name} className="flex justify-between border-b border-slate-100 py-1"><span className="truncate">{p.product_name} <span className="text-slate-400">×{p.qty}</span></span><b className="text-emerald-700 whitespace-nowrap">{fmt(p.gross_profit)} ₺</b></div>)}</div></div>}
    </div>
  );
};
