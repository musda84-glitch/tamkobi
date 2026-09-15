import React, { useCallback, useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, CalendarClock, AlertTriangle, FilePlus2, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const QUICK = [0, 7, 15, 30, 45, 60, 90];

export const ContactTermsModal = ({ contact, onClose, onSaved }) => {
  useEscape(onClose);
  const [days, setDays] = useState(contact.payment_term_days || 0);
  const [rate, setRate] = useState(contact.late_fee_rate || 0);
  const [applyOpen, setApplyOpen] = useState(true);
  const [aging, setAging] = useState(null);
  const [invoicing, setInvoicing] = useState(false);

  const loadAging = useCallback(() => {
    axios
      .get(`${API_URL}/contacts/${contact.id}/aging`)
      .then((r) => setAging(r.data))
      .catch(() => setAging({ rows: [], total_remaining: 0, total_overdue: 0, total_late_fee: 0 }));
  }, [contact.id]);

  useEffect(() => {
    loadAging();
  }, [loadAging]);

  const save = async () => {
    try {
      const r = await axios.post(`${API_URL}/contacts/${contact.id}/apply-terms`, {
        payment_term_days: Number(days),
        late_fee_rate: Number(rate),
        apply_to_open_invoices: applyOpen,
      });
      toast.success(r.data.message);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    }
  };

  const invoiceLateFees = async () => {
    if (invoicing) return;
    setInvoicing(true);
    try {
      const r = await axios.post(`${API_URL}/contacts/${contact.id}/invoice-late-fees`, { approve: true });
      toast.success(r.data.message || "Vade farkı faturası kesildi.");
      loadAging();
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Vade farkı faturası kesilemedi.");
    } finally {
      setInvoicing(false);
    }
  };

  const canInvoice = (aging?.total_late_fee || 0) > 0;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4 text-xs shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="contact-terms-modal"
      >
        <div className="flex justify-between items-start border-b pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-emerald-600" /> Vade Uygula — {contact.name}
            </h3>
            <p className="text-slate-500">Bu cariye kesilen faturalarda otomatik vade ve gecikme (vade farkı) oranı</p>
          </div>
          <button onClick={onClose} className="text-slate-400" data-testid="terms-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">Vade (gün)</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {QUICK.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`px-2 py-1 rounded-lg border font-semibold ${Number(days) === d ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600"}`}
                  data-testid={`terms-quick-${d}`}
                >
                  {d === 0 ? "Peşin" : `${d} gün`}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full bg-slate-50 border rounded-lg p-2 font-bold"
              data-testid="terms-days-input"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Vade Farkı (% / ay)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full bg-slate-50 border rounded-lg p-2 font-bold"
              data-testid="terms-rate-input"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Vadesi geçen faturalara günlük (oran/30) hesaplanır. Aşağıdan vade farkı faturası kesebilirsiniz; faturalar listesine düşer.
            </p>
            <label className="flex items-center gap-1.5 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={applyOpen}
                onChange={(e) => setApplyOpen(e.target.checked)}
                className="rounded"
                data-testid="terms-apply-open"
              />
              Açık faturaların vadesini yeniden hesapla
            </label>
          </div>
        </div>

        {aging && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-bold text-slate-800">Açık Faturalar & Yaşlandırma</div>
              <div className="flex gap-3 text-[11px] flex-wrap justify-end">
                <span>
                  Açık: <b>{fmt(aging.total_remaining)} ₺</b>
                </span>
                <span className="text-rose-600">
                  Vadesi Geçen: <b>{fmt(aging.total_overdue)} ₺</b>
                </span>
                {aging.total_late_fee > 0 && (
                  <span className="text-amber-600">
                    Vade Farkı: <b>{fmt(aging.total_late_fee)} ₺</b>
                  </span>
                )}
              </div>
            </div>
            <table className="w-full" data-testid="aging-table">
              <thead className="text-slate-500 uppercase text-[10px] border-b">
                <tr>
                  <th className="text-left py-1">Fatura</th>
                  <th className="py-1">Tarih</th>
                  <th className="py-1">Vade</th>
                  <th className="py-1 text-right">Kalan</th>
                  <th className="py-1 text-right">Gecikme</th>
                  <th className="py-1 text-right">Vade Farkı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!aging.rows || aging.rows.length === 0) && (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-slate-400">
                      Açık fatura yok.
                    </td>
                  </tr>
                )}
                {(aging.rows || []).map((r) => (
                  <tr key={r.invoice_id} className={r.overdue_days > 0 ? "bg-rose-50/50" : ""}>
                    <td className="py-1 font-mono font-semibold">{r.invoice_number}</td>
                    <td className="py-1 text-center text-slate-500">{r.issue_date}</td>
                    <td className="py-1 text-center text-slate-500">{r.due_date}</td>
                    <td className="py-1 text-right font-bold">{fmt(r.remaining)} ₺</td>
                    <td className="py-1 text-right">
                      {r.overdue_days > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold">
                          <AlertTriangle className="w-3 h-3" /> {r.overdue_days} gün
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-1 text-right text-amber-700 font-semibold">{r.late_fee ? `${fmt(r.late_fee)} ₺` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canInvoice && (
              <div
                className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5"
                data-testid="terms-late-fee-banner"
              >
                <div className="text-[11px] text-amber-900">
                  <b>{fmt(aging.total_late_fee)} ₺</b> vade farkı hesaplandı. Faturalar listesine satış (VF) belgesi olarak yansıtmak için kesin.
                </div>
                <button
                  type="button"
                  onClick={invoiceLateFees}
                  disabled={invoicing}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-lg font-semibold"
                  data-testid="terms-invoice-late-fees"
                >
                  {invoicing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus2 className="w-3.5 h-3.5" />}
                  Vade Farkı Faturası Kes
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border rounded-lg">
            İptal
          </button>
          <button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="terms-save">
            Vadeyi Uygula
          </button>
        </div>
      </div>
    </div>
  );
};
