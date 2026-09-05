import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, Zap, Search } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

export const ChannelCatalogModal = ({ companyId, onClose, onAdded }) => {
  useEscape(onClose);
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => axios.get(`${API_URL}/integrations/ecommerce/catalog?company_id=${companyId}`).then((r) => setData(r.data)).catch(() => toast.error("Katalog yüklenemedi."));
  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (code) => {
    setBusy(code);
    try { const r = await axios.post(`${API_URL}/integrations/ecommerce/add-channel`, { company_id: companyId, channel: code }); toast.success(r.data.message); load(); onAdded(); }
    catch (e) { toast.error(e.response?.data?.detail || "Eklenemedi."); } finally { setBusy(""); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()} data-testid="channel-catalog-modal">
        <div className="flex items-center justify-between"><div><h3 className="text-base font-bold text-slate-900">Satış Kanalı Ekle</h3><p className="text-slate-500">Pazaryerleri, e-ticaret altyapıları, e-ihracat platformları ve entegratörler — BizimHesap ile aynı kanal kataloğu.</p></div><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="channel-catalog-close"><X className="w-4 h-4" /></button></div>
        <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kanal ara…" className="pl-8 pr-3 py-2 bg-slate-50 border rounded-xl w-full" data-testid="channel-catalog-search" /></div>
        {!data ? <div className="text-slate-400 p-6">Yükleniyor…</div> : data.groups.map((g) => {
          const chs = g.channels.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
          return chs.length ? (
            <div key={g.group} data-testid={`channel-group-${g.group}`}><div className="font-bold text-slate-900 mb-1.5">{g.group} <span className="text-slate-400 font-normal">({g.channels.length})</span></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{chs.map((c) => (
                <div key={c.code} className={`border rounded-xl p-2.5 flex flex-col gap-1 ${c.added ? "bg-emerald-50/50 border-emerald-200" : "bg-white border-slate-200"}`} data-testid={`channel-item-${c.code}`}>
                  <div className="flex items-center justify-between"><b className="text-slate-800 truncate">{c.name}</b>{c.live_api && <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" title={c.live_api} />}</div>
                  <div className="text-[10px] text-slate-400 leading-tight">{c.live_api ? c.live_api : "Sipariş: Excel/AI yükleme · komisyon & kârlılık"}</div>
                  {c.added ? <span className="text-[10px] font-semibold text-emerald-700">Ekli</span> : <button onClick={() => add(c.code)} disabled={busy === c.code} className="mt-auto self-start px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid={`channel-add-${c.code}`}><Plus className="w-3 h-3" /> Ekle</button>}
                </div>))}</div>
            </div>) : null;
        })}
      </div>
    </div>
  );
};

export const CHANNEL_FIELD_LABELS = {
  shopphp: { api_key: "Sipariş XML (c=siparisler) — kod veya tam adres yapıştırın", api_secret: "Ürün XML (c=shopphp) — kod veya tam adres (RSS değil!)", supplier_id: "Stok/Fiyat XML (c=alter) — kod veya tam adres", store_url: "Mağaza Adresi (örn. https://www.magazam.com.tr)" },
  trendyol: { api_key: "API Key", api_secret: "API Secret", supplier_id: "Satıcı ID (Supplier ID)", store_url: "Mağaza Adresi (opsiyonel)" },
};
