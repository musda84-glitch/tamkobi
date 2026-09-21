import type { Contact, Invoice } from "../types";
import type { BankAccount, BankTx, Partner } from "./finance";
import { fmtMoney, idOf } from "./money";

export const MATCH_MODES = [
  { key: "contact", label: "Cari" },
  { key: "invoice", label: "Cari + Fatura" },
  { key: "transfer", label: "Kasa / Hesap (Virman)" },
  { key: "category", label: "Sadece Kategori" },
] as const;

export type MatchMode = (typeof MATCH_MODES)[number]["key"];

export type BankMatchTx = BankTx;

export type BankConnection = {
  id?: string;
  _id?: string;
  provider?: string;
  provider_name?: string;
  linked_account_id?: string;
  linked_account_name?: string;
  status?: string;
  mode?: string;
  last_synced_at?: string;
  synced_count?: number;
  last_error?: string;
  auto_sync?: boolean;
  auto_match?: boolean;
  auto_matched_count?: number;
};

export type MatchRule = {
  id?: string;
  _id?: string;
  pattern?: string;
  contact_id?: string;
  contact_name?: string;
  category?: string;
  target_account_id?: string;
  target_account_name?: string;
  hits?: number;
};

export type MatchSuggestion = {
  pattern?: string;
  count?: number;
  contact_id?: string;
  contact_name?: string;
  category?: string;
  target_account_id?: string;
  target_account_name?: string;
  consistent?: boolean;
};

export type MatchDraft = {
  mode: MatchMode;
  contact_id: string;
  invoice_id: string;
  target_account_id: string;
  category: string;
  learn: boolean;
};

export type SelectGroup = { label: string; options: { value: string; label: string }[] };

export function emptyMatchDraft(tx?: BankMatchTx | null): MatchDraft {
  return {
    mode: "contact",
    contact_id: tx?.suggested_contact_id || "",
    invoice_id: "",
    target_account_id: "",
    category: "",
    learn: true,
  };
}

export function invoiceRemaining(inv?: Invoice | null): number {
  return (Number(inv?.grand_total) || 0) - (Number(inv?.paid_amount) || 0);
}

export function openInvoices(invoices: Invoice[], contactId: string, tx: BankMatchTx): Invoice[] {
  if (!contactId) return [];
  const want = tx.type === "inflow" ? "sales" : "purchase";
  const amount = Number(tx.amount) || 0;
  return (invoices || [])
    .filter((i) =>
      i.contact_id === contactId
      && i.payment_status !== "paid"
      && i.status !== "draft"
      && i.invoice_type === want
    )
    .sort((a, b) => Math.abs(invoiceRemaining(a) - amount) - Math.abs(invoiceRemaining(b) - amount));
}

export function matchTargets(accounts: BankAccount[], tx: BankMatchTx): BankAccount[] {
  const src = tx.account_id || "";
  return (accounts || []).filter((a) => idOf(a) !== src && !a.is_integrated);
}

export function canSubmitMatch(d: MatchDraft): boolean {
  if (d.mode === "category") return !!d.category.trim();
  if (d.mode === "transfer") return !!d.target_account_id;
  if (d.mode === "invoice") return !!d.invoice_id;
  return true;
}

export function matchPayload(d: MatchDraft) {
  return {
    learn: !!d.learn,
    category: d.category.trim() || null,
    contact_id: d.mode === "contact" || d.mode === "invoice" ? d.contact_id || null : null,
    invoice_id: d.mode === "invoice" ? d.invoice_id || null : null,
    target_account_id: d.mode === "transfer" ? d.target_account_id || null : null,
  };
}

export const CONN_STATUS_TR: Record<string, string> = {
  connected: "Canlı bağlı",
  simulated: "Simüle",
  error: "Hata",
  disconnected: "Bağlı değil",
};

export const MATCHED_VIA_TR: Record<string, string> = {
  auto: "Otomatik",
  rule: "Kural",
  suggestion: "Öneri",
  manual: "Manuel",
};

export function connStatusTr(status?: string | null): string {
  if (!status) return "—";
  return CONN_STATUS_TR[status] || status;
}

export function connStatusTone(status?: string | null): "green" | "amber" | "red" | "slate" {
  if (status === "connected") return "green";
  if (status === "simulated") return "amber";
  if (status === "error") return "red";
  return "slate";
}

export function matchedViaTr(via?: string | null): string {
  if (!via) return "Manuel";
  return MATCHED_VIA_TR[via] || "Manuel";
}

export function matchResultLabel(tx: BankMatchTx): string {
  const parts = [
    tx.contact_name,
    tx.target_account_name ? `${tx.target_account_name} (virman)` : null,
    tx.related_invoice_number,
    tx.category,
  ].filter(Boolean);
  return parts.join(" · ") || "Eşleşti";
}

export function suggestionLabel(sg: MatchSuggestion): string {
  return [
    sg.contact_name,
    sg.target_account_name ? `${sg.target_account_name} (virman)` : null,
    sg.category,
  ].filter(Boolean).join(" · ") || "—";
}

export function ruleLabel(rule: MatchRule): string {
  const dest = [rule.contact_name, rule.target_account_name ? `${rule.target_account_name} (virman)` : null, rule.category]
    .filter(Boolean)
    .join(" · ") || "—";
  return `"${rule.pattern || ""}" → ${dest}`;
}

export function contactSelectGroups(contacts: Contact[], suggestedId?: string | null): SelectGroup[] {
  const options = (contacts || []).map((c) => ({
    value: idOf(c),
    label: suggestedId && idOf(c) === suggestedId ? `${c.name} ★` : (c.name || "Cari"),
  }));
  return options.length ? [{ label: "Cariler", options }] : [];
}

export function invoiceSelectGroups(invoices: Invoice[]): SelectGroup[] {
  const options = (invoices || []).map((i) => ({
    value: idOf(i),
    label: `${i.invoice_number || "Fatura"} · kalan ${fmtMoney(invoiceRemaining(i))}`,
  }));
  return [{ label: "Açık faturalar", options }];
}

export function transferSelectGroups(accounts: BankAccount[], partners: Partner[] = []): SelectGroup[] {
  const groups: SelectGroup[] = [];
  const options = (accounts || []).map((a) => ({
    value: idOf(a),
    label: `${a.bank_name || "Hesap"} — ${a.account_name || ""}`.trim(),
  }));
  if (options.length) groups.push({ label: "Kasa / Hesap", options });
  const active = (partners || []).filter((p) => p.is_active !== false);
  if (active.length) {
    groups.push({
      label: "Ortaklar Hesabı",
      options: active.map((p) => ({
        value: `partner:${idOf(p)}`,
        label: `${p.name || "Ortak"} (Ortak · %${p.share_percent ?? 0} · ${fmtMoney(p.balance)})`,
      })),
    });
  }
  return groups;
}
