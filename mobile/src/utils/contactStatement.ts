import { fmtMoney } from "./money";

export type StatementInvoice = {
  invoice_number?: string;
  invoice_type?: string;
  issue_date?: string;
  grand_total?: number;
  status?: string;
};

export type StatementPayment = {
  type?: string;
  date?: string;
  amount?: number;
  account_name?: string;
  description?: string;
};

export type StatementRow = {
  date: string;
  doc: string;
  debit: number;
  credit: number;
  kind: "invoice" | "payment";
  balance: number;
};

export function buildStatementRows(data: {
  invoices?: StatementInvoice[];
  payments?: StatementPayment[];
}): StatementRow[] {
  const rows: Omit<StatementRow, "balance">[] = [];
  (data.invoices || [])
    .filter((i) => i.status !== "cancelled")
    .forEach((i) =>
      rows.push({
        date: i.issue_date || "",
        doc: `${i.invoice_number || "Fatura"} • ${i.invoice_type === "sales" ? "Satış Faturası" : "Alış Faturası"}`,
        debit: i.invoice_type === "sales" ? Number(i.grand_total) || 0 : 0,
        credit: i.invoice_type === "sales" ? 0 : Number(i.grand_total) || 0,
        kind: "invoice",
      })
    );
  (data.payments || [])
    .filter((p) => p.type !== "transfer")
    .forEach((p) =>
      rows.push({
        date: p.date || "",
        doc: `${p.type === "inflow" ? "Tahsilat" : "Ödeme"} • ${p.account_name || ""}${p.description ? " • " + p.description : ""}`.replace(/ • $/, ""),
        debit: p.type === "inflow" ? 0 : Number(p.amount) || 0,
        credit: p.type === "inflow" ? Number(p.amount) || 0 : 0,
        kind: "payment",
      })
    );
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let bal = 0;
  return rows.map((r) => {
    bal += (r.debit || 0) - (r.credit || 0);
    return { ...r, balance: bal };
  });
}

export function statementText(
  contact: { name?: string; balance?: number },
  rows: StatementRow[],
  companyName?: string
): string {
  const last = rows.slice(-12);
  const lines = last.map(
    (r) => `${r.date}  ${r.doc.split(" • ").slice(0, 2).join(" ")}  ${r.debit ? "Borç " + fmtMoney(r.debit) : "Alacak " + fmtMoney(r.credit)}`
  );
  const bal = rows.length ? rows[rows.length - 1].balance : Number(contact.balance) || 0;
  return `${companyName || "Firmamız"} - Cari Hesap Ekstresi
Sayın ${contact.name || "Cari"}
Tarih: ${new Date().toLocaleDateString("tr-TR")}

${lines.join("\n")}

Güncel Bakiye: ${fmtMoney(Math.abs(bal))} ${bal > 0 ? "(Borcunuz)" : bal < 0 ? "(Alacağınız)" : ""}

Bilgilerinize sunarız.`;
}

export function smsBalanceText(contact: { name?: string; balance?: number }): string {
  const n = Number(contact.balance) || 0;
  return `Sayın ${contact.name || "Cari"}, ${new Date().toLocaleDateString("tr-TR")} itibarıyla cari bakiyeniz ${fmtMoney(Math.abs(n))} ${n > 0 ? "borç" : "alacak"} olarak görünmektedir. Detaylı ekstre için bize ulaşın.`;
}

export function balanceMessage(contact: { name?: string; balance?: number }): string {
  const n = Number(contact.balance) || 0;
  return `Sayın ${contact.name || "Cari"}, ${new Date().toLocaleDateString("tr-TR")} tarihi itibarıyla cari hesap bakiyeniz ${fmtMoney(Math.abs(n))} ${n > 0 ? "borç" : "alacak"} olarak görünmektedir. Bilgilerinize sunarız.`;
}

export function waDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "").replace(/^0/, "90");
}
