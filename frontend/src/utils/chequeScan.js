/** Çek / senet tarama taslağını forma uygula. */

export function chequeAmountInput(amount, sep = ".") {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

export function applyChequeScan(form, draft, match) {
  if (!form || !draft) return form;
  const amount = chequeAmountInput(Number(draft.amount) || 0, ".");
  const contactId = String(match?.id || match?._id || "").trim();
  const text = (v) => String(v || "").trim();
  return {
    ...form,
    instrument: draft.instrument === "promissory" ? "promissory" : draft.instrument === "cheque" ? "cheque" : form.instrument,
    direction: draft.direction === "issued" ? "issued" : draft.direction === "received" ? "received" : form.direction,
    ...(amount ? { amount } : {}),
    ...(text(draft.due_date) ? { due_date: text(draft.due_date) } : {}),
    ...(text(draft.issue_date) ? { issue_date: text(draft.issue_date) } : {}),
    ...(text(draft.serial_no) ? { serial_no: text(draft.serial_no) } : {}),
    ...(text(draft.bank_name) ? { bank_name: text(draft.bank_name) } : {}),
    ...(text(draft.bank_branch) ? { bank_branch: text(draft.bank_branch) } : {}),
    ...(text(draft.account_no) ? { account_no: text(draft.account_no) } : {}),
    ...(text(draft.drawer_name) ? { drawer_name: text(draft.drawer_name) } : {}),
    ...(text(draft.notes) ? { notes: text(draft.notes) } : {}),
    ...(contactId ? { contact_id: contactId } : {}),
  };
}

export const CHEQUE_SCAN_IDLE_HINT =
  "Kamera veya galeri ile çek / senet okuyun; tutar, vade ve banka dolar. Gerekirse yapay zeka okur.";

export function chequeScanHint(draft) {
  if (!draft || !(Number(draft.amount) > 0)) return "Çek okunamadı.";
  const kind = draft.instrument === "promissory" ? "Senet" : "Çek";
  const way = draft.direction === "issued" ? "verilen" : "alınan";
  return `${way} ${kind.toLowerCase()} okundu · ${chequeAmountInput(Number(draft.amount), ",")} ₺`;
}
