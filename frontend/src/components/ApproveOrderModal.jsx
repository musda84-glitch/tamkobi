import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, CheckCircle, Loader2, Plug } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { ShipmentPackageFields, packageDefaultsFromOrder, packagePayload } from "./ShipmentPackageFields";

export const ApproveOrderModal = ({ order, companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [carriers, setCarriers] = useState(null);
  const [carrier, setCarrier] = useState(order.cargo_carrier || "");
  const [createShipment, setCreateShipment] = useState(true);
  const [pkg, setPkg] = useState(() => packageDefaultsFromOrder(order));
  const [pkgHint, setPkgHint] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API_URL}/integrations/cargo?company_id=${companyId}`).then((r) => {
      const list = r.data.sort((a, b) => Number(b.status === "connected" && b.is_active) - Number(a.status === "connected" && a.is_active));
      setCarriers(list);
      setCarrier((cur) => cur || (list.find((c) => c.status === "connected" && c.is_active) || list[0])?.carrier_code || "");
    }).catch(() => setCarriers([]));
  }, [companyId]);

  useEffect(() => {
    const ids = [...new Set((order?.items || []).map((it) => it.product_id).filter(Boolean))];
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      const byId = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const r = await axios.get(`${API_URL}/products/${id}`);
          byId[id] = r.data;
          byId[String(id)] = r.data;
        } catch { /* skip */ }
      }));
      if (cancelled) return;
      const next = packageDefaultsFromOrder(order, byId);
      setPkg(next);
      setPkgHint((next.desi || next.weight || next.length) ? "Stok kartındaki paket bilgileri otomatik dolduruldu; düzenleyebilirsiniz." : "");
    })();
    return () => { cancelled = true; };
  }, [order]);

  const submit = async () => {
    if (!carrier) { toast.error("Kargo firması seçin."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/orders/${order.id}/approve`, { cargo_carrier: carrier });
      let msg = "Sipariş onaylandı.";
      if (createShipment && !order.cargo_tracking_number) {
        const r = await axios.post(`${API_URL}/cargo/create-shipment`, { carrier_code: carrier, order_id: order.id, customer_name: order.customer_name, address: order.shipping_address, city: order.city, company_id: companyId, customer_phone: order.customer_phone, ...packagePayload(pkg) });
        msg += ` ${r.data.message || `Kargo kaydı oluşturuldu — Takip No: ${r.data.tracking_number}`}`;
      }
      toast.success(msg); onDone?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="approve-order-modal">
        <div className="flex justify-between items-start border-b pb-2"><div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-600" /> Siparişi Onayla — {order.order_number}</h3><p className="text-slate-500">{order.customer_name} • {order.city}</p></div><button onClick={onClose} className="text-slate-400" data-testid="approve-close"><X className="w-5 h-5" /></button></div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">Kargo Firması (entegrasyonlardan)</label>
          {carriers === null ? <div className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor…</div> : carriers.length === 0 ? <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Tanımlı kargo entegrasyonu yok. Firma Ayarları → Kargo bölümünden ekleyin.</div> : (
            <div className="grid grid-cols-2 gap-2">
              {carriers.map((c) => { const ok = c.status === "connected" && c.is_active; return (
                <button key={c.carrier_code} type="button" onClick={() => setCarrier(c.carrier_code)} className={`text-left border-2 rounded-xl p-2.5 transition ${carrier === c.carrier_code ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-400"}`} data-testid={`approve-carrier-${c.carrier_code}`}>
                  <div className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-500" /><span className="font-bold text-slate-900 truncate">{c.carrier_name}</span></div>
                  <div className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? "text-emerald-700" : "text-slate-400"}`}><Plug className="w-3 h-3" /> {ok ? "Bağlı" : "Bağlı değil (simüle)"}</div>
                  {c.customer_number && <div className="text-[10px] font-mono text-slate-400">Müşteri No: {c.customer_number}</div>}
                </button>); })}
            </div>
          )}
        </div>
        {!order.cargo_tracking_number && <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={createShipment} onChange={(e) => setCreateShipment(e.target.checked)} className="rounded" data-testid="approve-create-shipment" /> Onayla ve kargo kaydı oluştur (takip numarası entegrasyondan alınır)</label>}
        {createShipment && !order.cargo_tracking_number && <ShipmentPackageFields value={pkg} onChange={setPkg} idPrefix="approve-pkg" hint={pkgHint} />}
        <div className="flex justify-end gap-2 border-t pt-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={submit} disabled={busy || !carrier} className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="approve-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Onayla</button></div>
      </div>
    </div>
  );
};
