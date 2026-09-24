/** Tahsilat / ödeme makbuz taslağını forma uygula. */

export function receiptAmountInput(amount, sep = ".") {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

export function applyReceiptDraft(form, draft, amountSep = ".") {
  if (!form || !draft) return form;
  const type = draft.type === "outflow" ? "outflow" : "inflow";
  const amount = receiptAmountInput(Number(draft.amount) || 0, amountSep);
  const description = String(draft.description || "").trim();
  return {
    ...form,
    type,
    ...(amount ? { amount } : {}),
    ...(description ? { description } : {}),
  };
}

export function receiptScanHint(draft) {
  if (!draft || !(Number(draft.amount) > 0)) return "Makbuz okunamadı.";
  const kind = draft.type === "outflow" ? "Ödeme" : "Tahsilat";
  const amt = receiptAmountInput(Number(draft.amount), ",");
  return `${kind} okundu · ${amt} ₺`;
}
