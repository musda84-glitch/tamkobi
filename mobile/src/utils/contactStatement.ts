import { fmtDate, fmtMoney } from "./money";

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

export type StatementCheque = {
  instrument?: string;
  direction?: string;
  serial_no?: string;
  bank_name?: string;
  due_date?: string;
  issue_date?: string;
  date?: string;
  amount?: number;
};

export type StatementRow = {
  date: string;
  doc: string;
  debit: number;
  credit: number;
  kind: "invoice" | "payment" | "cheque";
  balance: number;
};

export function buildStatementRows(
  data: {
    invoices?: StatementInvoice[];
    payments?: StatementPayment[];
    cheques?: StatementCheque[];
  },
  { includeCheques = false }: { includeCheques?: boolean } = {},
): StatementRow[] {
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
  if (includeCheques) {
    (data.cheques || []).forEach((ch) => {
      const kind = ch.instrument === "promissory" ? "Senet" : "Çek";
      const received = ch.direction === "received" || ch.direction === "inflow";
      const dir = received ? "Alınan" : "Verilen";
      rows.push({
        date: ch.due_date || ch.issue_date || ch.date || "",
        doc: `${dir} ${kind}${ch.serial_no ? ` • ${ch.serial_no}` : ""}${ch.bank_name ? ` • ${ch.bank_name}` : ""}`,
        debit: received ? 0 : Number(ch.amount) || 0,
        credit: received ? Number(ch.amount) || 0 : 0,
        kind: "cheque",
      });
    });
  }
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
    (r) => `${fmtDate(r.date)}  ${r.doc.split(" • ").slice(0, 2).join(" ")}  ${r.debit ? "Borç " + fmtMoney(r.debit) : "Alacak " + fmtMoney(r.credit)}`
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

export type StatementCompany = {
  name?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  tax_office?: string;
  tax_number?: string;
};

export function statementPrintTitle(variant: "statement" | "detailed" | "reconciliation" = "statement"): string {
  if (variant === "reconciliation") return "CARİ HESAP MUTABAKAT MEKTUBU";
  if (variant === "detailed") return "DETAYLI CARİ HESAP EKSTRESİ";
  return "CARİ HESAP EKSTRESİ";
}

export function statementPrintHtml(
  contact: { name?: string; tax_number_or_id?: string; tax_office?: string; address?: string; city?: string; balance?: number },
  rows: StatementRow[],
  company?: StatementCompany | string | null,
  opts?: { variant?: "statement" | "detailed" | "reconciliation" },
): string {
  const co = typeof company === "string" ? { name: company } : (company || {});
  const last = rows.length ? rows[rows.length - 1].balance : Number(contact.balance) || 0;
  const side = last > 0 ? "Borçlu" : last < 0 ? "Alacaklı" : "";
  const totD = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totC = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const trs = rows.map((r, i) => (
    `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 ? "background:#f8fafc;" : ""}">`
    + `<td style="padding:8px;font-family:ui-monospace,monospace;color:#64748b">${esc(fmtDate(r.date))}</td>`
    + `<td style="padding:8px">${esc(r.doc)}</td>`
    + `<td style="padding:8px;text-align:right">${r.debit ? `${esc(fmtMoney(r.debit))}` : ""}</td>`
    + `<td style="padding:8px;text-align:right">${r.credit ? `${esc(fmtMoney(r.credit))}` : ""}</td>`
    + `<td style="padding:8px;text-align:right;font-weight:600">${esc(fmtMoney(r.balance))}</td></tr>`
  )).join("");
  const balBox = last > 0 ? "background:#fff1f2;color:#be123c" : "background:#ecfdf5;color:#047857";
  const created = new Date().toLocaleString("tr-TR");
  const variant = opts?.variant || "statement";
  const heading = statementPrintTitle(variant);
  const reconLetter = variant === "reconciliation"
    ? `<p style="margin-top:16px;color:#475569;line-height:1.5">Yukarıdaki cari hesap bakiyemize göre kayıtlarda görünen tutarın mutabakatını rica ederiz. Aşağıdaki hareket listesini kontrol ederek 7 gün içinde yazılı veya elektronik olarak onayınızı bildirmenizi saygılarımızla arz ederiz.</p>`
    : "";
  const footerKind = variant === "reconciliation" ? "mutabakat mektubu" : "ekstre";
  return `<div data-print="statement" style="padding:40px;font-size:12px;color:#1e293b;font-family:-apple-system,Roboto,'Segoe UI',Arial,Helvetica,sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #0f172a;padding-bottom:16px">
      <div>
        <div style="font-size:16px;font-weight:700">${esc(co.name || "Firmamız")}</div>
        <div style="color:#64748b">${esc(co.address || "")} ${esc(co.city || "")}</div>
        <div style="color:#64748b">VD: ${esc(co.tax_office || "")} • VKN: ${esc(co.tax_number || "")}</div>
        <div style="color:#64748b">${[co.phone, co.email].filter(Boolean).map(esc).join(" • ")}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:24px;font-weight:900;letter-spacing:-0.3px">${esc(heading)}</div>
        <div style="color:#64748b">Tarih: ${esc(new Date().toLocaleDateString("tr-TR"))}</div>
      </div>
    </div>
    <div style="margin-top:20px">
      <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:4px">Sayın</div>
      <div style="font-weight:700;font-size:16px">${esc(contact.name || "Cari")}</div>
      <div style="color:#64748b">VKN/TCKN: ${esc(contact.tax_number_or_id || "")}${contact.tax_office ? ` • ${esc(contact.tax_office)}` : ""}</div>
      ${contact.address ? `<div style="color:#64748b">${esc(contact.address)} ${esc(contact.city || "")}</div>` : ""}
    </div>
    ${reconLetter}
    <table style="width:100%;border-collapse:collapse;margin-top:24px">
      <thead><tr style="background:#0f172a;color:#fff">
        <th style="text-align:left;padding:8px;border-radius:6px 0 0 0">Tarih</th>
        <th style="text-align:left;padding:8px">Belge / Açıklama</th>
        <th style="text-align:right;padding:8px">Borç</th>
        <th style="text-align:right;padding:8px">Alacak</th>
        <th style="text-align:right;padding:8px;border-radius:0 6px 0 0">Bakiye</th>
      </tr></thead>
      <tbody>${trs || `<tr><td colspan="5" style="padding:8px">Hareket yok.</td></tr>`}</tbody>
      <tfoot><tr style="border-top:2px solid #0f172a;font-weight:700">
        <td style="padding:8px" colspan="2">TOPLAM</td>
        <td style="padding:8px;text-align:right">${esc(fmtMoney(totD))}</td>
        <td style="padding:8px;text-align:right">${esc(fmtMoney(totC))}</td>
        <td style="padding:8px;text-align:right">${esc(fmtMoney(last))}</td>
      </tr></tfoot>
    </table>
    <div style="margin-top:24px;display:flex;justify-content:flex-end">
      <div style="border-radius:12px;padding:12px 16px;text-align:right;${balBox}">
        <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8">Güncel Bakiye</div>
        <div style="font-size:20px;font-weight:900">${esc(fmtMoney(Math.abs(last)))} <span style="font-size:12px;font-weight:600">${esc(side)}</span></div>
      </div>
    </div>
    <div style="margin-top:40px;color:#94a3b8;font-style:italic">Bu ${esc(footerKind)} ${esc(co.name || "Firmamız")} tarafından ${esc(created)} tarihinde oluşturulmuştur. Mutabakat için lütfen 7 gün içinde geri dönüş yapınız.</div>
  </div>`;
}
