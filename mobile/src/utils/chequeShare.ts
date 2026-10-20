import { Platform } from "react-native";
import type { ApiClient } from "../api/client";
import { get } from "../api/client";
import { A4_PRINT_PX, htmlToPdfFile, printHtmlNative } from "./nativePrint";
import {
  openPrintHtml,
  printDocumentHtml,
  safePrintFilename,
  type PrintCompany,
} from "./orderPrint";
import { enrichPrintCompany } from "./orderShare";
import { chequeAsReceiptTx, receiptPrintHtml, type ReceiptContact, type ReceiptTx } from "./receiptPrint";
import { chequeReceiptLabel, type Cheque } from "./cheques";

export type ChequeReceiptGroup = {
  receipt_group_id?: string;
  cheques?: Cheque[];
  total?: number;
};

type BuiltReceipt = { title: string; body: string; filename: string };

async function printReceiptDocument(
  title: string,
  body: string,
  filename: string,
): Promise<boolean> {
  if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) return true;
  const document = printDocumentHtml(title, body, "a4");
  try {
    if (await printHtmlNative(document, A4_PRINT_PX)) return true;
  } catch {
    /* PDF */
  }
  try {
    if (await htmlToPdfFile(document, filename, A4_PRINT_PX)) return true;
  } catch {
    /* fail */
  }
  return false;
}

/** Aynı makbuz HTML’i ve dosya adı; yazdırmak yerine PDF’i expo-sharing ile açar. */
async function shareReceiptDocument(
  title: string,
  body: string,
  filename: string,
): Promise<boolean> {
  const document = printDocumentHtml(title, body, "a4");
  try {
    if (await htmlToPdfFile(document, filename, A4_PRINT_PX)) return true;
  } catch {
    /* paylaşım kapalı */
  }
  return false;
}

async function deliverReceipt(built: BuiltReceipt, mode: "print" | "share"): Promise<boolean> {
  const ok = mode === "share"
    ? await shareReceiptDocument(built.title, built.body, built.filename)
    : await printReceiptDocument(built.title, built.body, built.filename);
  if (ok) return true;
  throw new Error(mode === "share" ? "Makbuz paylaşılamadı." : "Makbuz yazdırılamadı.");
}

async function loadReceiptContact(
  client: ApiClient | null | undefined,
  contactId?: string,
  fallback?: ReceiptContact | null,
): Promise<ReceiptContact | null> {
  if (!client || !contactId) return fallback || null;
  try {
    const full = await get<{ contact?: ReceiptContact } & ReceiptContact>(client, `/contacts/${contactId}/overview`);
    return { ...(fallback || {}), ...(full.contact || full), name: full.contact?.name || full.name || fallback?.name };
  } catch {
    return fallback || null;
  }
}

async function buildChequeReceipt(
  row: Cheque,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<BuiltReceipt> {
  const printCompany = await enrichPrintCompany(client, company);
  const contact = await loadReceiptContact(
    client,
    row.contact_id,
    row.contact_name ? { name: row.contact_name } : null,
  );
  const tx = chequeAsReceiptTx(row);
  const body = receiptPrintHtml(tx, printCompany, contact);
  const title = chequeReceiptLabel(row);
  const filename = `makbuz-${safePrintFilename(row.serial_no || row.number, "cek")}.pdf`;
  return { title, body, filename };
}

function groupTotal(rows: Cheque[], announced?: number): number {
  if (typeof announced === "number" && Number.isFinite(announced)) return announced;
  return Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 100) / 100;
}

async function buildChequeGroupReceipt(
  group: ChequeReceiptGroup,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<BuiltReceipt> {
  const rows = (group.cheques || []).filter(Boolean);
  const head = rows[0];
  if (!head) throw new Error("Makbuz yazdırılamadı.");
  const printCompany = await enrichPrintCompany(client, company);
  const contact = await loadReceiptContact(
    client,
    head.contact_id,
    head.contact_name ? { name: head.contact_name } : null,
  );
  const total = groupTotal(rows, group.total);
  const tx = chequeAsReceiptTx({
    ...head,
    id: group.receipt_group_id || head.id || head._id,
    amount: total,
  });
  tx.description = rows.map((row) => row.number || row.serial_no || "Çek").filter(Boolean).join(", ");
  tx.amount = total;
  const body = receiptPrintHtml(tx, printCompany, contact, rows);
  const title = chequeReceiptLabel(head);
  const filename = `makbuz-${safePrintFilename(group.receipt_group_id || head.serial_no || head.number, "cek")}.pdf`;
  return { title, body, filename };
}

export async function printChequeReceipt(
  row: Cheque,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  return deliverReceipt(await buildChequeReceipt(row, company, client), "print");
}

export async function shareChequeReceipt(
  row: Cheque,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  return deliverReceipt(await buildChequeReceipt(row, company, client), "share");
}

export async function printChequeGroupReceipt(
  group: ChequeReceiptGroup,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  return deliverReceipt(await buildChequeGroupReceipt(group, company, client), "print");
}

export async function shareChequeGroupReceipt(
  group: ChequeReceiptGroup,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  return deliverReceipt(await buildChequeGroupReceipt(group, company, client), "share");
}

export async function printPaymentReceipt(
  tx: ReceiptTx,
  company?: PrintCompany | null,
  client?: ApiClient | null,
  contact?: ReceiptContact | null,
  contactId?: string,
): Promise<boolean> {
  const printCompany = await enrichPrintCompany(client, company);
  const party = await loadReceiptContact(client, contactId, contact);
  const body = receiptPrintHtml(tx, printCompany, party);
  const title = tx.type === "inflow" ? "Tahsilat Makbuzu" : tx.type === "transfer" ? "Virman Makbuzu" : "Tediye Makbuzu";
  const filename = `makbuz-${safePrintFilename(tx.id, "odeme")}.pdf`;
  if (await printReceiptDocument(title, body, filename)) return true;
  throw new Error("Makbuz yazdırılamadı.");
}
