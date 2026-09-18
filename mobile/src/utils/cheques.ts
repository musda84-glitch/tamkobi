export type Cheque = {
  id?: string;
  _id?: string;
  number?: string;
  instrument?: string;
  direction?: string;
  status?: string;
  status_label?: string;
  contact_id?: string;
  contact_name?: string;
  amount?: number;
  currency?: string;
  issue_date?: string;
  due_date?: string;
  serial_no?: string;
  bank_name?: string;
  drawer_name?: string;
  account_name?: string;
  endorsed_to_name?: string;
  overdue?: boolean;
  due_soon?: boolean;
  notes?: string;
};

export type ChequeSummary = {
  count?: number;
  open_count?: number;
  portfolio?: number;
  issued_open?: number;
  overdue_received?: number;
  overdue_issued?: number;
  due_this_week?: number;
  bounced?: number;
  received_count?: number;
  issued_count?: number;
};

export const CHEQUE_STATUS_TR: Record<string, string> = {
  open: "Portföy / Açık",
  collected: "Tahsil edildi",
  paid: "Ödendi",
  endorsed: "Ciro edildi",
  bounced: "Karşılıksız",
  cancelled: "İptal",
};

export const CHEQUE_FILTERS = [
  { key: "all", label: "Tümü" },
  { key: "received", label: "Alınan" },
  { key: "issued", label: "Verilen" },
  { key: "open", label: "Açık" },
  { key: "overdue", label: "Vadesi geçen" },
] as const;

export type ChequeFilter = (typeof CHEQUE_FILTERS)[number]["key"];

export function chequeStatusTr(row: Pick<Cheque, "status" | "status_label">): string {
  return row.status_label || CHEQUE_STATUS_TR[String(row.status)] || String(row.status || "—");
}

export function chequeTitle(row: Cheque): string {
  const kind = row.instrument === "promissory" ? "Senet" : "Çek";
  const way = row.direction === "issued" ? "verilen" : "alınan";
  return `${row.number || kind} · ${way} ${kind.toLowerCase()}`;
}

export function chequeTone(row: Cheque): "green" | "red" | "amber" | "slate" {
  if (row.status === "bounced") return "red";
  if (row.status === "collected" || row.status === "paid") return "green";
  if (row.overdue) return "red";
  if (row.due_soon) return "amber";
  return "slate";
}

/** Alınan çek tahsil edilir, verilen çek ödenir; kapalı kayıtta işlem yok. */
export function chequeAction(row: Cheque): { path: "collect" | "pay"; label: string } | null {
  if (row.status !== "open") return null;
  return row.direction === "received"
    ? { path: "collect", label: "Tahsil et" }
    : { path: "pay", label: "Öde" };
}

export function filterCheques(rows: Cheque[], filter: ChequeFilter, query: string): Cheque[] {
  const s = query.trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (filter === "received" && r.direction !== "received") return false;
    if (filter === "issued" && r.direction !== "issued") return false;
    if (filter === "open" && r.status !== "open") return false;
    if (filter === "overdue" && !r.overdue) return false;
    if (!s) return true;
    return [r.number, r.serial_no, r.contact_name, r.bank_name, r.drawer_name]
      .some((v) => String(v || "").toLowerCase().includes(s));
  });
}
