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

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function statementPrintHtml(
  contact: { name?: string; tax_number_or_id?: string; balance?: number },
  rows: StatementRow[],
  companyName?: string,
): string {
  const last = rows.length ? rows[rows.length - 1].balance : Number(contact.balance) || 0;
  const side = last > 0 ? "Borçlu" : last < 0 ? "Alacaklı" : "";
  const trs = rows.map((r) => (
    `<tr><td>${esc(r.date)}</td><td>${esc(r.doc)}</td>`
    + `<td style="text-align:right">${r.debit ? esc(fmtMoney(r.debit)) : ""}</td>`
    + `<td style="text-align:right">${r.credit ? esc(fmtMoney(r.credit)) : ""}</td>`
    + `<td style="text-align:right">${esc(fmtMoney(r.balance))}</td></tr>`
  )).join("");
  return `<div>
    <h1 style="font-size:18px;margin:0 0 8px">${esc(companyName || "Firmamız")} — Cari Hesap Ekstresi</h1>
    <p style="margin:0 0 12px">Sayın ${esc(contact.name || "Cari")}${contact.tax_number_or_id ? ` · VKN ${esc(contact.tax_number_or_id)}` : ""}<br/>Tarih: ${esc(new Date().toLocaleDateString("tr-TR"))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 4px">Tarih</th>
        <th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 4px">Belge</th>
        <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px 4px">Borç</th>
        <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px 4px">Alacak</th>
        <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px 4px">Bakiye</th>
      </tr></thead>
      <tbody>${trs || `<tr><td colspan="5">Hareket yok.</td></tr>`}</tbody>
    </table>
    <p style="margin-top:12px;font-weight:700">Güncel bakiye ${esc(fmtMoney(Math.abs(last)))} ${esc(side)}</p>
  </div>`;
}
