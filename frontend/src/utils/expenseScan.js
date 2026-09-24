/** Masraf fişi taslağını forma uygula. */

const CATS = [
  "Kira", "Elektrik / Su / Doğalgaz", "İnternet / Telefon", "Yakıt", "Yemek",
  "Yol / Ulaşım", "Ofis Malzemesi", "Personel Masrafı", "Vergi / Harç / SGK",
  "Bakım / Onarım", "Pazarlama / Reklam", "Yazılım / Abonelik", "Kargo / Nakliye",
  "Muhasebe / Danışmanlık", "Diğer",
];

export function expenseAmountInput(amount, sep = ".") {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", sep);
}

export function applyExpenseScan(form, draft, match) {
  if (!form || !draft) return form;
  const amount = expenseAmountInput(Number(draft.amount) || 0, ".");
  const vat = Number(draft.vat_rate);
  const category = String(draft.category || "").trim();
  const contactId = String(match?.id || match?._id || "").trim();
  const text = (v) => String(v || "").trim();
  return {
    ...form,
    ...(amount ? { amount } : {}),
    ...(vat === 0 || vat === 1 || vat === 10 || vat === 20 ? { vat_rate: vat } : {}),
    vat_included: draft.vat_included !== false,
    ...(text(draft.date) ? { date: text(draft.date) } : {}),
    ...(text(draft.description) ? { description: text(draft.description) } : {}),
    ...(CATS.includes(category) ? { category } : {}),
    ...(text(draft.document_no) ? { document_no: text(draft.document_no) } : {}),
    ...(text(draft.notes) ? { notes: text(draft.notes) } : {}),
    ...(contactId ? { contact_id: contactId } : {}),
  };
}

export function expenseScanHint(draft) {
  if (!draft || !(Number(draft.amount) > 0)) return "Fiş okunamadı.";
  const cat = String(draft.category || "Masraf").trim() || "Masraf";
  return `${cat} fişi okundu · ${expenseAmountInput(Number(draft.amount), ",")} ₺`;
}
