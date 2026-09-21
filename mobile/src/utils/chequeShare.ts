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

export async function printChequeReceipt(
  row: Cheque,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
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
  if (await printReceiptDocument(title, body, filename)) return true;
  throw new Error("Makbuz yazdırılamadı.");
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
