import { fmtMoney } from "./money";
import type { PrintCompany } from "./orderPrint";
import { chequeReceiptKind, type Cheque } from "./cheques";

export type ReceiptTx = {
  id?: string;
  type: "inflow" | "outflow" | "transfer";
  date?: string;
  account_name?: string;
  category?: string;
  description?: string;
  amount?: number;
  contact_name?: string;
  target_account_name?: string;
};

export type ReceiptContact = {
  name?: string;
  tax_number_or_id?: string;
  address?: string;
  city?: string;
  balance?: number;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: unknown): string {
  return fmtMoney(n, "TRY");
}

export function chequeAsReceiptTx(row: Cheque): ReceiptTx {
  const kind = chequeReceiptKind(row);
  const instrument = row.instrument === "promissory" ? "Senet" : "Çek";
  const way = row.direction === "issued" ? "Verilen" : "Alınan";
  const settled = row.status === "collected" || row.status === "paid";
  return {
    id: row.id || row._id,
    type: kind === "collection" ? "inflow" : "outflow",
    date: String(row.settled_at || row.issue_date || row.due_date || "").slice(0, 10),
    account_name: row.account_name || "Çek Portföyü",
    category: settled
      ? (kind === "collection" ? "Çek/Senet Tahsilatı" : "Çek/Senet Ödemesi")
      : `${way} ${instrument}`,
    description: [row.number, row.serial_no ? `seri ${row.serial_no}` : "", row.due_date ? `vade ${row.due_date}` : ""]
      .filter(Boolean)
      .join(" · "),
    amount: row.amount,
    contact_name: row.contact_name,
  };
}

/** Web ReceiptPrint ile aynı tahsilat / tediye makbuzu gövdesi. */
export function receiptPrintHtml(tx: ReceiptTx, company?: PrintCompany | null, contact?: ReceiptContact | null): string {
  const isCollection = tx.type === "inflow";
  const isTransfer = tx.type === "transfer";
  const titleUpper = isCollection ? "TAHSİLAT MAKBUZU" : isTransfer ? "VİRMAN MAKBUZU" : "TEDİYE MAKBUZU";
  const partyLabel = isCollection ? "Sayın (Ödeyen)" : isTransfer ? "Karşı hesap / cari" : "Sayın (Alan)";
  const partyName = contact?.name || tx.contact_name || tx.target_account_name || "—";
  const totalLabel = isCollection ? "Yalnız tahsil edilen" : isTransfer ? "Yalnız virman tutarı" : "Yalnız ödenen";
  const no = `MKB-${String(tx.id || "").replace(/-/g, "").slice(0, 8).toUpperCase() || "YENI"}`;
  const bal = typeof contact?.balance === "number"
    ? `<div style="color:#475569">İşlem sonrası cari bakiye: <b>${esc(money(Math.abs(contact.balance || 0)))} ${contact.balance > 0 ? "borç" : contact.balance < 0 ? "alacak" : ""}</b></div>`
    : "";
  return `<div data-print="receipt" style="border:2px solid #0f172a;border-radius:8px;padding:24px;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:12px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px">
      <div>
        <div style="font-size:16px;font-weight:900">${esc(company?.name || "")}</div>
        <div style="color:#64748b">${esc(company?.address || "")} ${esc(company?.city || "")}</div>
        <div style="color:#64748b">VD: ${esc(company?.tax_office || "")} • VKN: ${esc(company?.tax_number || "")} • ${esc(company?.phone || "")}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:900">${titleUpper}</div>
        <div style="font-family:ui-monospace,monospace">No: ${esc(no)}</div>
        <div style="color:#64748b">Tarih: ${esc(tx.date || "")}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8">${esc(partyLabel)}</div>
        <div style="font-weight:700;font-size:14px">${esc(partyName)}</div>
        <div style="color:#64748b">VKN/TCKN: ${esc(contact?.tax_number_or_id || "—")}</div>
        <div style="color:#64748b">${esc(contact?.address || "")} ${esc(contact?.city || "")}</div>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8">${isTransfer ? "Hesap" : "Ödeme Şekli"}</div>
        <div style="font-weight:600">${esc(tx.account_name || "")}</div>
        <div style="color:#64748b">${esc(tx.category || "")}${tx.target_account_name ? ` → ${esc(tx.target_account_name)}` : ""}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid #cbd5e1">
      <thead><tr style="background:#f1f5f9">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #cbd5e1">Açıklama</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #cbd5e1">Tutar</th>
      </tr></thead>
      <tbody><tr>
        <td style="padding:8px">${esc(tx.description || "")}</td>
        <td style="padding:8px;text-align:right;font-weight:700">${esc(money(tx.amount))}</td>
      </tr></tbody>
      <tfoot><tr style="background:#0f172a;color:#fff">
        <td style="padding:8px;font-weight:700">${esc(totalLabel)} toplam</td>
        <td style="padding:8px;text-align:right;font-size:16px;font-weight:900">${esc(money(tx.amount))}</td>
      </tr></tfoot>
    </table>
    ${bal}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:28px">
      <div style="text-align:center"><div style="border-bottom:1px solid #94a3b8;height:48px"></div><div style="color:#64748b;margin-top:4px">${isCollection ? "Teslim Eden" : "Teslim Alan"} (Kaşe / İmza)</div></div>
      <div style="text-align:center"><div style="border-bottom:1px solid #94a3b8;height:48px"></div><div style="color:#64748b;margin-top:4px">${isCollection ? "Teslim Alan" : "Teslim Eden"} — ${esc(company?.name || "")}</div></div>
    </div>
  </div>`;
}
