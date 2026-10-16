import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { MoneyInput } from "./MoneyInput";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { classifyTestPayment, navigation, postBankForm } from "./VposSettingsPanel";

export function money2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Sunucu quote metni. Alıcıda komisyon satırı açık; satıcıda yok. */
export function cardPayQuoteText(quote, payer) {
  if (!quote || quote.charge_amount == null || quote.charge_amount === "") return "";
  const charge = `${formatTrAmount(Number(quote.charge_amount))} ₺`;
  if (payer === "buyer") {
    const fee = `${formatTrAmount(Number(quote.commission_amount || 0))} ₺`;
    return `Ödenecek tutar: ${charge} (komisyon ${fee} dahil)`;
  }
  return `Ödenecek tutar: ${charge}`;
}

export function B2BCardPay({ token, balance, cardPayment }) {
  const openBalance = Number(balance) > 0 ? Number(balance) : 0;
  const maxInstallment = Math.max(1, Number(cardPayment?.max_installment) || 1);
  const payer = cardPayment?.commission_payer === "buyer" ? "buyer" : "seller";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(openBalance);
  const [installment, setInstallment] = useState(1);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [iframeUrl, setIframeUrl] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const text = money2(amount);
    if (!text || Number(text) <= 0) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ amount: text, installment: String(installment || 1) });
      axios.get(`${API_URL}/public/b2b/${token}/card-quote?${params.toString()}`)
        .then((r) => { if (!cancelled) setQuote(r.data || null); })
        .catch(() => { if (!cancelled) setQuote(null); });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, amount, installment, token]);

  const start = async () => {
    const text = money2(amount);
    if (!text || Number(text) <= 0) {
      toast.error("Tutar 0'dan büyük olmalı.");
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/public/b2b/${token}/card-payments`, {
        amount: text,
        installment: maxInstallment > 1 ? installment : 1,
        description: "Cari bakiye ödemesi",
      });
      const next = classifyTestPayment(res.data || {});
      if (next.type === "form") {
        postBankForm(next.actionUrl, next.fields);
        return;
      }
      if (next.type === "iframe") {
        setIframeUrl(next.url);
        return;
      }
      if (next.type === "redirect") {
        navigation.assign(next.url);
        return;
      }
      toast.error("Ödeme sayfası açılamadı.");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" && detail.trim() ? detail : "Ödeme başlatılamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAmount(openBalance);
          setInstallment(1);
          setQuote(null);
          setIframeUrl("");
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"
        data-testid="b2b-card-pay"
      >
        <CreditCard className="w-3.5 h-3.5" /> Kartla öde
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-end sm:items-center justify-center p-4" {...backdropDismissProps(() => setOpen(false))}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" data-testid="b2b-card-pay-modal">
            <div className="font-bold text-slate-900">Kartla öde</div>
            <p className="text-[11px] text-slate-500">Kart bilgisi bu sayfaya yazılmaz. Ödeme bankanın sayfasında tamamlanır.</p>
            <div>
              <label className="block font-semibold mb-1">Tutar (₺)</label>
              <MoneyInput
                value={amount}
                decimals={2}
                maxFractionDigits={2}
                onChange={(n) => setAmount(n ?? 0)}
                className="w-full bg-slate-50 border rounded-lg p-2 font-bold"
                data-testid="b2b-card-amount"
              />
            </div>
            {maxInstallment > 1 && (
              <div>
                <label className="block font-semibold mb-1">Taksit</label>
                <select
                  value={String(installment)}
                  onChange={(e) => setInstallment(Number(e.target.value) || 1)}
                  className="w-full bg-slate-50 border rounded-lg p-2"
                  data-testid="b2b-card-installment"
                >
                  {Array.from({ length: maxInstallment }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>{n === 1 ? "Tek çekim" : `${n} taksit`}</option>
                  ))}
                </select>
              </div>
            )}
            {quote && (
              <div className="text-sm font-semibold text-slate-800" data-testid="b2b-card-quote">
                {cardPayQuoteText(quote, payer)}
              </div>
            )}
            {iframeUrl && (
              <iframe title="Kart ödemesi" src={iframeUrl} className="w-full h-80 border rounded-xl" data-testid="b2b-card-iframe" />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 border rounded-lg">Kapat</button>
              <button type="button" disabled={busy} onClick={start} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-50" data-testid="b2b-card-start">
                {busy ? "Açılıyor…" : "Ödemeye geç"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
