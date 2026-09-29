import React, { useEffect, useState } from "react";
import axios from "axios";
import { Factory, Loader2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";

/** Sipariş → tek reçete üretim emri: istasyon seçimi. */
export function OrderProduceRecipeModal({
  order,
  companyId,
  lineCount = 0,
  busy = false,
  onClose,
  onConfirm,
}) {
  useEscape(onClose);
  const [stations, setStations] = useState(null);
  const [station, setStation] = useState("");
  const label = order?.held_label || order?.order_number || "Sipariş";

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API_URL}/production/work-orders/stations`, { params: { company_id: companyId } })
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data.filter(Boolean) : [];
        setStations(list);
        if (list.length === 1) setStation(list[0]);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="order-produce-recipe-modal"
      >
        <div className="flex items-start justify-between gap-2 border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Factory className="w-4 h-4 text-amber-700" /> Üretim emri ver
            </h3>
            <p className="text-slate-500 mt-0.5">
              {label} — {lineCount || "?"} kalemden 1 reçete + üretim emri
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400" data-testid="order-produce-recipe-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">İstasyon</span>
          {stations === null ? (
            <div className="flex items-center gap-1.5 text-slate-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> İstasyonlar yükleniyor…
            </div>
          ) : stations.length === 0 ? (
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
              placeholder="Örn. CNC, Kesim, Montaj"
              className="w-full border rounded-lg p-2 bg-slate-50"
              data-testid="order-produce-station-input"
            />
          ) : (
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="w-full border rounded-lg p-2 bg-slate-50"
              data-testid="order-produce-station-select"
            >
              <option value="">İstasyon seçin…</option>
              {stations.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-slate-500">Atölye kartlarındaki tüm adımlara bu istasyon yazılır.</p>
        </label>

        <div className="flex justify-end gap-2 border-t pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg" data-testid="order-produce-recipe-cancel">
            İptal
          </button>
          <button
            type="button"
            disabled={busy || !String(station || "").trim()}
            onClick={() => onConfirm?.(String(station || "").trim())}
            className="flex items-center gap-1 px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
            data-testid="order-produce-recipe-submit"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />}
            Emri oluştur
          </button>
        </div>
      </div>
    </div>
  );
}
