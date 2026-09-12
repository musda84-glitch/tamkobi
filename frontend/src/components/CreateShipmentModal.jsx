import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, Loader2, Plug, Package } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { ShipmentPackageFields, packageDefaultsFromOrder, packagePayload } from "./ShipmentPackageFields";

/** Carrier-agnostic shipment create modal with package/desi fields. */
export const CreateShipmentModal = ({ order, companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [carriers, setCarriers] = useState(null);
  const [carrier, setCarrier] = useState(order.cargo_carrier || "");
  const [pkg, setPkg] = useState(() => packageDefaultsFromOrder(order));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/integrations/cargo?company_id=${companyId}`).then((r) => {
      const list = (r.data || []).slice().sort((a, b) => Number(b.status === "connected" && b.is_active) - Number(a.status === "connected" && a.is_active));
      setCarriers(list);
      setCarrier((cur) => cur || (list.find((c) => c.status === "connected" && c.is_active) || list[0])?.carrier_code || "");
    }).catch(() => setCarriers([]));
  }, [companyId]);

  const submit = async () => {
    if (!carrier) { toast.error("Kargo firması seçin."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/cargo/create-shipment`, {
        carrier_code: carrier,
        order_id: order.id || order._id,
        customer_name: order.customer_name,
        address: order.shipping_address || order.address,
        city: order.city,
        customer_phone: order.customer_phone,
        company_id: companyId,
        ...packagePayload(pkg),
      });
      toast.success(r.data.message || `Kargo kaydı oluşturuldu — Takip: ${r.data.tracking_number}`);
      onDone?.(r.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kargo oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="create-shipment-modal">
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Package className="w-4 h-4 text-indigo-600" /> Kargo Oluştur — {order.order_number}</h3>
            <p className="text-slate-500">{order.customer_name} • {order.city}</p>
          </div>
          <button onClick={onClose} className="text-slate-400" data-testid="create-shipment-close"><X className="w-5 h-5" /></button>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">Kargo firması</label>
          {carriers === null ? (
            <div className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor…</div>
          ) : carriers.length === 0 ? (
            <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Tanımlı kargo entegrasyonu yok. Kargo ayarlarından ekleyin.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {carriers.map((c) => {
                const ok = c.status === "connected" && c.is_active;
                return (
                  <button key={c.carrier_code} type="button" onClick={() => setCarrier(c.carrier_code)} className={`text-left border-2 rounded-xl p-2.5 transition ${carrier === c.carrier_code ? "border-indigo-600 bg-indigo-50" : "border-slate-200 hover:border-slate-400"}`} data-testid={`ship-carrier-${c.carrier_code}`}>
                    <div className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-500" /><span className="font-bold text-slate-900 truncate">{c.carrier_name}</span></div>
                    <div className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? "text-emerald-700" : "text-slate-400"}`}><Plug className="w-3 h-3" /> {ok ? "Bağlı" : "Bağlı değil (simüle)"}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ShipmentPackageFields value={pkg} onChange={setPkg} idPrefix="ship-pkg" />

        <div className="flex justify-end gap-2 border-t pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button onClick={submit} disabled={busy || !carrier} className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="create-shipment-submit">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} Kargola
          </button>
        </div>
      </div>
    </div>
  );
};
