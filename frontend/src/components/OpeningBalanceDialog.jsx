import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { accountDisplayLabel } from "../utils/accountLabel";
import { defaultOpeningDate, istanbulToday, openingPreview } from "../utils/openingBalance";
import { MoneyInput } from "./MoneyInput";

export function OpeningBalanceDialog({ account, transactions, onClose, onSaved }) {
  const id = account?.id || account?._id || "";
  const [amount, setAmount] = useState(null);
  const [date, setDate] = useState(() => defaultOpeningDate(transactions, id, istanbulToday()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = openingPreview(account?.is_customer_card_pool ? 0 : account?.current_balance, amount);
  const ready = Number.isFinite(Number(amount)) && Math.abs(Number(amount)) >= 0.009 && /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));

  const confirm = async () => {
    if (!ready || saving || !id) return;
    setSaving(true);
    let closed = false;
    try {
      const payload = {
        amount: Math.round(Number(amount) * 100) / 100,
        date,
      };
      const trimmed = note.trim();
      if (trimmed) payload.note = trimmed;
      await axios.post(`${API_URL}/banking/accounts/${id}/opening-balance`, payload);
      toast.success("Açılış/devir bakiyesi kaydedildi. Cari etkilenmedi.");
      closed = true;
      if (onClose) onClose();
      if (onSaved) await onSaved();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Açılış bakiyesi kaydedilemedi.");
    } finally {
      if (!closed) setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      data-testid="opening-balance-modal"
      {...backdropDismissProps(() => { if (!saving && onClose) onClose(); })}
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-900">Açılış/Devir bakiyesi ekle</h3>
        <p className="text-xs text-slate-500">{accountDisplayLabel(account)}</p>
        <label className="block text-xs font-semibold text-slate-700">
          Tutar (+/−)
          <MoneyInput
            allowNegative
            value={amount}
            onChange={setAmount}
            className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
            placeholder="0,00"
            data-testid="opening-balance-amount"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Tarih
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
            data-testid="opening-balance-date"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Açıklama
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
            placeholder="Açılış / devir"
            data-testid="opening-balance-note"
          />
        </label>
        <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid="opening-balance-preview">
          {preview || "Tutar girildiğinde bakiye önizlemesi burada görünür."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs border rounded-lg"
            data-testid="opening-balance-cancel"
            disabled={saving}
            onClick={() => { if (!saving && onClose) onClose(); }}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg disabled:opacity-50"
            data-testid="opening-balance-confirm"
            disabled={!ready || saving}
            onClick={confirm}
          >
            {saving ? "Kaydediliyor…" : "Onayla"}
          </button>
        </div>
      </div>
    </div>
  );
}
