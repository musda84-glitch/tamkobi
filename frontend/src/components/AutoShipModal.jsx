
import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { channelTr } from "../utils/labels";
import { ShipmentPackageFields, emptyPackageForm, packagePayload } from "./ShipmentPackageFields";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export const AutoShipModal = ({ companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [carriers, setCarriers] = useState([]);
  const [carrier, setCarrier] = useState("geliver");
  const [channels, setChannels] = useState(["shopphp", "trendyol"]);
  const [allowSim, setAllowSim] = useState(false);
  const [pkg, setPkg] = useState(() => emptyPackageForm());
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/integrations/cargo?company_id=${companyId}`).then((r) => setCarriers(r.data)).catch(() => {}); }, [companyId]);
  useEffect(() => {
    setBusy(true); setResult(null);
    axios.post(`${API_URL}/cargo/auto-ship`, { company_id: companyId, carrier_code: carrier, channels, dry_run: true }).then((r) => setPreview(r.data)).catch((e) => toast.error(e.response?.data?.detail || "Önizleme alınamadı.")).finally(() => setBusy(false));
  }, [companyId, carrier, channels]);
  const run = async () => {
    if (!window.confirm(`${preview.results.filter((r) => r.status === "ready").length} sipariş için ${carrier} kargo kaydı oluşturulsun mu?`)) return;
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/cargo/auto-ship`, { company_id: companyId, carrier_code: carrier, channels, allow_simulated: allowSim, default_desi: packagePayload(pkg).desi, default_package_count: packagePayload(pkg).package_count, default_weight: packagePayload(pkg).weight, default_length: packagePayload(pkg).length, default_width: packagePayload(pkg).width, default_height: packagePayload(pkg).height }); setResult(r.data); toast.success(r.data.message); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || "Toplu kargolama başarısız."); } finally { setBusy(false); }
  };
  const rows = (result || preview)?.results || [];
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()} data-testid="auto-ship-modal">
        <div className="flex items-center justify-between"><h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Truck className="w-5 h-5 text-emerald-600" /> Günlük Toplu Kargolama</h3><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="auto-ship-close"><X className="w-4 h-4" /></button></div>
        <p className="text-slate-500">Onaylı / hazırlanıyor durumundaki, henüz kargo kaydı olmayan siparişler için tek tıkla gönderi oluşturur. Takip numarası siparişe yazılır; ShopPHP siparişlerinde mağazaya da bildirilir.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label>Taşıyıcı <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="border rounded-lg p-1.5 ml-1" data-testid="auto-ship-carrier">{!carriers.some((c) => c.carrier_code === "geliver") && <option value="geliver">Geliver (kurulmadı)</option>}{carriers.map((c) => <option key={c.carrier_code} value={c.carrier_code}>{c.carrier_name || c.carrier_code}{c.is_live || c.live ? " (canlı)" : ""}</option>)}</select></label>
          {["shopphp", "trendyol", "hepsiburada", "manual", "b2b"].map((ch) => <label key={ch} className="flex items-center gap-1"><input type="checkbox" checked={channels.includes(ch)} onChange={(e) => setChannels(e.target.checked ? [...channels, ch] : channels.filter((x) => x !== ch))} data-testid={`auto-ship-ch-${ch}`} /> {channelTr(ch)}</label>)}
        </div>
        <ShipmentPackageFields value={pkg} onChange={setPkg} idPrefix="auto-pkg" />
        {preview && !preview.live && <label className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-2 text-amber-800" data-testid="auto-ship-sim-warning"><AlertTriangle className="w-4 h-4 shrink-0" /><span>Bu taşıyıcı için canlı API yok. <input type="checkbox" checked={allowSim} onChange={(e) => setAllowSim(e.target.checked)} className="mx-1" data-testid="auto-ship-allow-sim" /> Simülasyon takip numarasıyla devam et (gerçek gönderi oluşmaz)</span></label>}
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Sipariş</th><th className="px-3 py-2 text-left">Kanal</th><th className="px-3 py-2 text-left">Alıcı / İl</th><th className="px-3 py-2 text-right">Tutar</th><th className="px-3 py-2 text-left">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{busy && !rows.length ? <tr><td colSpan={5} className="p-6 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /> Yükleniyor…</td></tr> : rows.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-slate-400" data-testid="auto-ship-empty">Kargolanacak sipariş yok.</td></tr> : rows.map((r) => (
              <tr key={r.order_id} data-testid={`auto-ship-row-${r.order_number}`}><td className="px-3 py-1.5 font-semibold">{r.order_number}</td><td className="px-3 py-1.5">{channelTr(r.channel)}</td><td className="px-3 py-1.5">{r.customer_name} <span className="text-slate-400">· {r.city}</span></td><td className="px-3 py-1.5 text-right">{fmt(r.total_amount)} ₺</td>
                <td className="px-3 py-1.5">{r.status === "ready" ? <span className="text-sky-700 font-semibold">Hazır</span> : r.status === "created" ? <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {r.tracking_number}</span> : r.status === "failed" ? <span className="text-rose-600" title={r.reason}>Hata: {r.reason}</span> : <span className="text-slate-400">Atlandı: {r.reason}</span>}</td></tr>))}</tbody></table>
        </div>
        <div className="flex justify-end gap-2">{result ? <button onClick={onClose} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold" data-testid="auto-ship-done">Kapat</button> : <button onClick={run} disabled={busy || !preview || !preview.results.some((r) => r.status === "ready") || (!preview.live && !allowSim)} className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="auto-ship-run">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} {preview ? preview.results.filter((r) => r.status === "ready").length : 0} Siparişi Kargola</button>}</div>
      </div>
    </div>
  );
};
