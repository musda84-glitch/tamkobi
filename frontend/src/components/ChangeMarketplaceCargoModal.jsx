import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, Loader2, Plug } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { channelTr } from "../utils/labels";
import { cargoChangeBody, cargoChangeConfirm, marketplaceCargoOptions } from "../utils/marketplaceCargo";

/** Pazaryeri paketinin kargo firmasını değiştirir (Trendyol cargoProvider vb.). */
export const ChangeMarketplaceCargoModal = ({ order, onClose, onDone }) => {
  useEscape(onClose);
  const options = useMemo(() => marketplaceCargoOptions(order), [order]);
  const [carrier, setCarrier] = useState(() => String(order?.cargo_carrier || options[0]?.carrier_code || "").trim());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cur = String(order?.cargo_carrier || "").trim();
    if (cur) setCarrier(cur);
  }, [order]);

  const currentLabel = order?.cargo_carrier_name || order?.cargo_carrier || "—";
  const channelLabel = channelTr(order?.channel);

  const submit = async () => {
    if (!carrier) {
      toast.error("Kargo firması seçin.");
      return;
    }
    const opt = options.find((o) => o.carrier_code === carrier);
    const name = opt?.carrier_name || carrier;
    if (!window.confirm(cargoChangeConfirm(order, name))) return;
    setBusy(true);
    try {
      const r = await axios.put(
        `${API_URL}/orders/${order.id || order._id}/cargo-carrier`,
        cargoChangeBody(carrier, name),
      );
      toast.success(r.data.message || "Pazaryeri kargo firması güncellendi.");
      onDone?.(r.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kargo firması güncellenemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="change-marketplace-cargo-modal"
      >
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-sky-600" /> Pazaryeri Kargo Firması
            </h3>
            <p className="text-slate-500 mt-0.5">
              {order?.order_number} · {channelLabel}
              {order?.customer_name ? ` · ${order.customer_name}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400" data-testid="change-marketplace-cargo-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 space-y-1" data-testid="change-marketplace-cargo-info">
          <div className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Pazaryerinden gelen bilgi</div>
          <div className="font-semibold text-slate-800">
            Mevcut kargo: <span className="text-sky-900">{currentLabel}</span>
          </div>
          {order?.cargo_tracking_number ? (
            <div className="text-slate-600 font-mono text-[11px]">Takip: {order.cargo_tracking_number}</div>
          ) : null}
          {order?.shipment_package_id || order?.external_id ? (
            <div className="text-slate-500 text-[10px]">
              Paket ID: {order.shipment_package_id || order.external_id}
            </div>
          ) : null}
          <p className="text-[10px] text-slate-500 pt-0.5">
            Seçim siparişe yazılır ve bağlı pazaryeri entegrasyonuna iletilir.
          </p>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">Yeni kargo firması</label>
          <div className="grid grid-cols-2 gap-2" data-testid="change-marketplace-cargo-list">
            {options.map((c) => (
              <button
                key={c.carrier_code}
                type="button"
                onClick={() => setCarrier(c.carrier_code)}
                className={`text-left border-2 rounded-xl p-2.5 transition ${
                  carrier === c.carrier_code ? "border-sky-600 bg-sky-50" : "border-slate-200 hover:border-slate-400"
                }`}
                data-testid={`mp-cargo-${c.carrier_code}`}
              >
                <div className="flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-bold text-slate-900 truncate">{c.carrier_name}</span>
                </div>
                {c.from_marketplace ? (
                  <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700">
                    <Plug className="w-3 h-3" /> Pazaryerinden
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !carrier}
            className="flex items-center gap-1 px-4 py-1.5 bg-sky-600 text-white rounded-lg font-semibold disabled:opacity-50"
            data-testid="change-marketplace-cargo-submit"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
            Pazaryerine kaydet
          </button>
        </div>
      </div>
    </div>
  );
};
