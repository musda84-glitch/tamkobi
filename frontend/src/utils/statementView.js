/** Cari ekstre gösterimi: filtre ve sıralama. Yürüyen bakiye burada hesaplanmaz. */

const SENT = new Set(["sent", "accepted", "received"]);
const PENDING = new Set(["queued", "pending"]);
const UNSENT = new Set(["none", "pending", "error"]);

function num(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value) {
  return String(value || "").slice(0, 10);
}

function trLower(value) {
  return String(value || "").toLocaleLowerCase("tr");
}

function docParts(row) {
  return String(row?.doc || "").split(" • ").map((part) => part.trim()).filter(Boolean);
}

export function statementDocType(row) {
  const kind = row?.kind;
  const doc = String(row?.doc || "").trim();
  if (kind === "cheque") {
    return trLower(doc).includes("senet") ? "Senet" : "Çek";
  }
  if (kind === "ledger") return doc;
  if (kind === "payment") return docParts(row)[0] || "Ödeme";
  const parts = docParts(row);
  if (parts.length > 1) return parts.slice(1).join(" • ");
  return doc;
}

export function statementDocTypeOptions(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach((row) => {
    const label = statementDocType(row);
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push(label);
  });
  return out;
}

export function statementETypeLabel(eType) {
  const value = String(eType || "").trim().toLowerCase();
  if (value === "e_invoice") return "e-Fatura";
  if (value === "e_archive") return "e-Arşiv";
  return "";
}

function rawGibState(row) {
  const direct = row?.einvoice_state;
  if (direct != null && String(direct).trim() !== "") return String(direct).trim().toLowerCase();
  if (row?.gib != null && String(row.gib).trim() !== "") return String(row.gib).trim().toLowerCase();
  return "";
}

export function statementGibBucket(row) {
  if (!row || typeof row !== "object") return null;
  const kind = row.kind;
  if (kind && kind !== "invoice") return null;
  const hasSignal = kind === "invoice" || row.einvoice_state != null || row.gib != null || row.e_type;
  if (!hasSignal) return null;
  const state = rawGibState(row);
  const eType = String(row.e_type || "").trim().toLowerCase();
  if (state === "paper" || eType === "paper") return "paper";
  if (SENT.has(state)) return "sent";
  if (PENDING.has(state)) return "pending";
  if (state === "error") return "error";
  return "none";
}

const GIB_PRESENTATION = {
  sent: { label: "GİB", className: "bg-emerald-100 text-emerald-800" },
  none: { label: "Kesilmedi", className: "bg-slate-100 text-slate-600" },
  pending: { label: "Kuyrukta", className: "bg-amber-100 text-amber-800" },
  error: { label: "Hata", className: "bg-rose-100 text-rose-700" },
  paper: { label: "Matbu", className: "bg-slate-200 text-slate-700" },
};

export function statementGibState(row) {
  const key = statementGibBucket(row);
  if (!key) return null;
  const eLabel = statementETypeLabel(row?.e_type);
  return {
    key,
    eLabel,
    eType: String(row?.e_type || ""),
    ...GIB_PRESENTATION[key],
  };
}

export function statementGibMatches(row, gib) {
  if (!gib || gib === "all") return true;
  const bucket = statementGibBucket(row);
  if (gib === "sent") return bucket === "sent";
  if (gib === "unsent") return UNSENT.has(bucket);
  return true;
}

export function statementFiltersActive(filters = {}) {
  return Boolean(
    String(filters.from || "").trim()
    || String(filters.to || "").trim()
    || String(filters.q || "").trim()
    || String(filters.docType || "").trim()
    || (filters.side && filters.side !== "all")
    || (filters.gib && filters.gib !== "all"),
  );
}

export function filterStatementRows(rows, filters = {}) {
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const q = trLower(String(filters.q || "").trim());
  const docType = String(filters.docType || "").trim();
  const side = filters.side || "all";
  const gib = filters.gib || "all";
  return (rows || []).filter((row) => {
    const date = isoDate(row?.date);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    if (docType && statementDocType(row) !== docType) return false;
    if (q && !trLower(row?.doc).includes(q)) return false;
    if (side === "debit" && !(num(row?.debit) > 0)) return false;
    if (side === "credit" && !(num(row?.credit) > 0)) return false;
    if (!statementGibMatches(row, gib)) return false;
    return true;
  });
}

function compareRows(a, b, key) {
  if (key === "doc") return trLower(a?.doc).localeCompare(trLower(b?.doc), "tr");
  if (key === "debit" || key === "credit" || key === "balance") return num(a?.[key]) - num(b?.[key]);
  return isoDate(a?.date).localeCompare(isoDate(b?.date));
}

export function sortStatementRows(rows, sort = {}) {
  const key = sort.key || "date";
  const dir = sort.dir === "desc" ? -1 : 1;
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareRows(a.row, b.row, key);
      if (cmp !== 0) return cmp * dir;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

export function statementView(rows, filters, sort) {
  return sortStatementRows(filterStatementRows(rows, filters), sort);
}

export function statementTotals(rows) {
  let debit = 0;
  let credit = 0;
  (rows || []).forEach((row) => {
    debit += num(row?.debit);
    credit += num(row?.credit);
  });
  return { debit, credit, net: debit - credit, count: (rows || []).length };
}
