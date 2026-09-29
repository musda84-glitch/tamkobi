import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, Loader2, Plug, Package, Warehouse } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { ShipmentPackageFields, packageDefaultsFromOrder, packagePayload } from "./ShipmentPackageFields";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { canWarehouseShip, isWarehouseShipClosed, isWarehouseShipped, WAREHOUSE_SHIP_HINT, WAREHOUSE_SHIP_NAME, warehouseShipPath } from "../utils/warehouseShip";

/** Carrier-agnostic shipment create modal with package/desi fields. */
export const CreateShipmentModal = ({ order, companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [carriers, setCarriers] = useState(null);
  const [carrier, setCarrier] = useState(order.cargo_carrier || "");
  const [pkg, setPkg] = useState(() => packageDefaultsFromOrder(order));
  const [pkgHint, setPkgHint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/integrations/cargo?company_id=${companyId}`).then((r) => {
      const list = (r.data || []).slice().sort((a, b) => Number(b.status === "connected" && b.is_active) - Number(a.status === "connected" && a.is_active));
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
        } catch { /* skip missing */ }
      }));
      if (cancelled) return;
      const next = packageDefaultsFromOrder(order, byId);
      const fromStock = next.desi || next.weight || next.length;
      setPkg(next);
      setPkgHint(fromStock ? "Stok kartındaki paket bilgileri otomatik dolduruldu; düzenleyebilirsiniz." : "");
    })();
    return () => { cancelled = true; };
  }, [order]);

  const oid = order.id || order._id;
  const alreadyWarehouse = isWarehouseShipped(order);
  const terminalClosed = isWarehouseShipClosed(order);
  const warehouseAllowed = canWarehouseShip(order);

  const submit = async () => {
    if (!carrier) { toast.error("Kargo firması seçin."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/cargo/create-shipment`, {
        carrier_code: carrier,
        order_id: oid,
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

  const shipFromWarehouse = async () => {
    if (alreadyWarehouse) { toast.info("Bu sipariş zaten depodan sevk edildi."); return; }
    if (terminalClosed) { toast.error("Teslim, tamamlanmış, iptal veya iade sipariş depodan sevk edilemez."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}${warehouseShipPath(oid)}`, { company_id: companyId });
      toast.success(r.data.message || "Sipariş depodan sevk edildi.");
      onDone?.(r.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Depodan sevk kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="create-shipment-modal">
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Package className="w-4 h-4 text-indigo-600" /> Kargo Oluştur — {order.order_number}</h3>
            <p className="text-slate-500">{order.customer_name} • {order.city}</p>
          </div>
          <button onClick={onClose} className="text-slate-400" data-testid="create-shipment-close"><X className="w-5 h-5" /></button>
        </div>

        <div className={`rounded-xl border-2 p-3 ${alreadyWarehouse ? "border-emerald-300 bg-emerald-50" : terminalClosed ? "border-slate-200 bg-slate-50" : "border-emerald-200 bg-emerald-50/80"}`} data-testid="warehouse-ship-option">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                <Warehouse className="w-4 h-4 text-emerald-700 shrink-0" /> {WAREHOUSE_SHIP_NAME}
              </div>
              <p className="text-[10px] text-emerald-800/90 mt-0.5 leading-snug">
                {alreadyWarehouse
                  ? "Bu sipariş depodan sevk edildi olarak işaretli."
                  : terminalClosed
                    ? "Teslim, tamamlanmış, iptal veya iade sipariş depodan sevk edilemez."
                    : WAREHOUSE_SHIP_HINT}
              </p>
            </div>
            <button
              type="button"
              onClick={shipFromWarehouse}
              disabled={busy || !warehouseAllowed}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50"
              data-testid="warehouse-ship-submit"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Warehouse className="w-3.5 h-3.5" />} Sevk et
            </button>
          </div>
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

        <ShipmentPackageFields value={pkg} onChange={setPkg} idPrefix="ship-pkg" hint={pkgHint} />

        <div className="flex justify-end gap-2 border-t pt-2 flex-wrap">
          <button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="button"
            onClick={shipFromWarehouse}
            disabled={busy || !warehouseAllowed}
            className="flex items-center gap-1 px-3 py-1.5 border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg font-semibold disabled:opacity-50"
            data-testid="warehouse-ship-footer"
          >
            <Warehouse className="w-3.5 h-3.5" /> Depodan sevk edildi
          </button>
          <button onClick={submit} disabled={busy || !carrier} className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="create-shipment-submit">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} Kargola
          </button>
        </div>
      </div>
    </div>
  );
};
