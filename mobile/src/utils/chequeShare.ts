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
import { chequeAsReceiptTx, receiptPrintHtml, type ReceiptContact } from "./receiptPrint";
import { chequeReceiptLabel, type Cheque } from "./cheques";

export async function printChequeReceipt(
  row: Cheque,
  company?: PrintCompany | null,
  client?: ApiClient | null,
): Promise<boolean> {
  const printCompany = await enrichPrintCompany(client, company);
  let contact: ReceiptContact | null = row.contact_name ? { name: row.contact_name } : null;
  if (client && row.contact_id) {
    try {
      const full = await get<{ contact?: ReceiptContact } & ReceiptContact>(client, `/contacts/${row.contact_id}/overview`);
      contact = { ...(full.contact || full), name: full.contact?.name || full.name || row.contact_name };
    } catch {
      /* name only */
    }
  }
  const tx = chequeAsReceiptTx(row);
  const body = receiptPrintHtml(tx, printCompany, contact);
  const title = chequeReceiptLabel(row);
  const filename = `makbuz-${safePrintFilename(row.serial_no || row.number, "cek")}.pdf`;
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
  throw new Error("Makbuz yazdırılamadı.");
}
