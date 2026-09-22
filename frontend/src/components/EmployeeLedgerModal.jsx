import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Wallet, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { ledgerPayPayload } from "../utils/personnelWage";
import { formatTrAmount } from "../utils/money";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const empIdOf = (e) => e?.id || e?._id || "";

export function EmployeeLedgerModal({ employee, companyId, accounts, remaining = 0, advances = 0, onClose, onDone }) {
  useEscape(onClose);
  const [side, setSide] = useState("alacak");
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : "");
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const first = accounts?.[0];
    if (first) setAccountId((cur) => cur || first.id || first._id || "");
  }, [accounts]);

  const save = async (e) => {
    e.preventDefault();
    const n = Number(String(amount).replace(",", "."));
    if (!(n > 0)) { toast.error("Tutar girin."); return; }
    if (!accountId) { toast.error("Kasa / banka / ortak seçin."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/personnel/bonuses`, {
        ...ledgerPayPayload(empIdOf(employee), side, amount, new Date().toISOString().slice(0, 7), note),
        ...splitPaymentTarget(accountId),
      });
      toast.success(`${employee.full_name} için ${side === "borc" ? "borç" : "bakiye"} ödemesi yapıldı.`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kayıt yazılamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose} data-testid="emp-ledger-modal">
      <form onSubmit={save} onClick={(ev) => ev.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" /> Bakiye ödemesi — {employee.full_name}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-slate-500">Kalan {formatTrAmount(remaining)} ₺</p>
        <div className="grid grid-cols-2 gap-1.5">
          {[["alacak", "Alacak"], ["borc", "Borç"]].map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => {
                setSide(k);
                setAmount(k === "borc" ? (advances > 0 ? String(advances) : "") : (remaining > 0 ? String(remaining) : ""));
              }}
              className={`py-2 rounded-lg border text-[12px] font-semibold ${side === k ? (k === "borc" ? "bg-rose-50 text-rose-800 border-rose-200" : "bg-emerald-50 text-emerald-800 border-emerald-200") : "bg-white text-slate-500 border-slate-200"}`}
              data-testid={`emp-ledger-side-${k}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500" data-testid="emp-ledger-hint">
          {side === "borc" ? "Personel borcunu yazar — kalan alacaktan düşülür." : "Kalan alacak bakiyesini öder — personel alacağı düşer."}
        </p>
        <div>
          <label className="block font-semibold mb-1">Tutar (₺)</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} font-bold`} data-testid="emp-ledger-amount" />
        </div>
        <div>
          <label className="block font-semibold mb-1">Açıklama</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={side === "borc" ? "Borç açıklaması" : "Bakiye ödemesi"} className={inputCls} data-testid="emp-ledger-note" />
        </div>
        <div>
          <label className="block font-semibold mb-1">Kasa / Banka / Ortak</label>
          <PaymentTargetSelect
            companyId={companyId}
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            testId="emp-ledger-account"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy || !accountId} className={`px-4 py-1.5 text-white rounded-lg font-semibold disabled:opacity-50 ${side === "borc" ? "bg-rose-600" : "bg-emerald-600"}`} data-testid="emp-ledger-submit">
            {busy ? "…" : side === "borc" ? "Borcu öde" : "Bakiyeyi öde"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EmployeeLedgerModal;
