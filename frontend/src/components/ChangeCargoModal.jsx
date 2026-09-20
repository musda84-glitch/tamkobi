import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Truck, Loader2, Plug } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { channelTr } from "../utils/labels";

export const ChangeCargoModal = ({ order, companyId, onClose, onDone }) => {
  useEscape(onClose);
  const [carriers, setCarriers] = useState(null);
  const [carrier, setCarrier] = useState(order.cargo_carrier || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      axios.get(`${API_URL}/integrations/cargo`, { params: { company_id: companyId } }).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/integrations/cargo/catalog`, { params: { company_id: companyId } }).catch(() => ({ data: [] })),
    ]).then(([inst, cat]) => {
      const installed = Array.isArray(inst.data) ? inst.data : [];
      const catalog = Array.isArray(cat.data) ? cat.data : [];
      const byCode = new Map();
      for (const c of catalog) byCode.set(c.carrier_code, { ...c, installed: !!c.installed });
      for (const c of installed) {
        byCode.set(c.carrier_code, {
          carrier_code: c.carrier_code,
          carrier_name: c.carrier_name || c.carrier_code,
          kind: c.kind,
          installed: true,
          status: c.status,
          is_active: c.is_active,
          customer_number: c.customer_number,
        });
      }
      const list = [...byCode.values()].sort((a, b) => Number(!!b.installed) - Number(!!a.installed));
      setCarriers(list);
      setCarrier((cur) => cur || order.cargo_carrier || list[0]?.carrier_code || "");
    }).catch(() => setCarriers([]));
  }, [companyId, order.cargo_carrier]);

  const submit = async () => {
    if (!carrier) { toast.error("Kargo firması seçin."); return; }
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/orders/${order.id || order._id}/cargo-carrier`, { cargo_carrier: carrier });
      toast.success(r.data.message || "Pazaryeri kargo firması güncellendi.");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kargo firması güncellenemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="change-cargo-modal">
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Truck className="w-4 h-4 text-violet-600" /> Pazaryeri kargo firması — {order.order_number}</h3>
            <p className="text-slate-500">{order.customer_name} • {channelTr(order.channel)}{order.cargo_carrier_name ? ` • ${order.cargo_carrier_name}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-slate-400" data-testid="change-cargo-close"><X className="w-5 h-5" /></button>
        </div>
        {carriers === null ? (
          <div className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor…</div>
        ) : carriers.length === 0 ? (
          <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Kargo firması listesi yüklenemedi.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {carriers.map((c) => {
              const ok = c.installed && c.status === "connected" && c.is_active !== false;
              return (
                <button key={c.carrier_code} type="button" onClick={() => setCarrier(c.carrier_code)} className={`text-left border-2 rounded-xl p-2.5 transition ${carrier === c.carrier_code ? "border-violet-600 bg-violet-50" : "border-slate-200 hover:border-slate-400"}`} data-testid={`change-cargo-${c.carrier_code}`}>
                  <div className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-500" /><span className="font-bold text-slate-900 truncate">{c.carrier_name}</span></div>
                  <div className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? "text-emerald-700" : "text-slate-400"}`}><Plug className="w-3 h-3" /> {ok ? "Bağlı" : c.installed ? "Kayıtlı" : "Katalog"}</div>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button onClick={submit} disabled={busy || !carrier} className="flex items-center gap-1 px-4 py-1.5 bg-violet-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="change-cargo-submit">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} Pazaryerine kaydet
          </button>
        </div>
      </div>
    </div>
  );
};
