import { todayYmd } from "./orderMoreMenu";

export function ymdPrefix(value: unknown): string {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** Fatura / sipariş belge tarihi (GİB IssueDate): invoice_date | issue_date | order_date | created_at. */
export function docDocumentDate(doc: {
  invoice_date?: string | null;
  issue_date?: string | null;
  order_date?: string | null;
  created_at?: string | null;
} | null | undefined): string {
  return (
    ymdPrefix(doc?.invoice_date)
    || ymdPrefix(doc?.issue_date)
    || ymdPrefix(doc?.order_date)
    || ymdPrefix(doc?.created_at)
  );
}

export function docHasOldDocumentDate(
  doc: Parameters<typeof docDocumentDate>[0],
  today = todayYmd(),
): boolean {
  const d = docDocumentDate(doc);
  return !!d && d < today;
}

/** Hızlı GİB gönderiminde eski tarih sorusu (Tarihi bugüne çek / Olduğu gibi gönder). */
export function shouldAskInvoiceDatePrompt(
  doc: Parameters<typeof docDocumentDate>[0],
  today = todayYmd(),
): boolean {
  return docHasOldDocumentDate(doc, today);
}

export type InvoiceDatePromptChoice = "stamp_now" | "keep";

export const INVOICE_DATE_PROMPT = {
  title: "Belge tarihi",
  message: "Belge tarihi bugünden eski. GİB’e gönderirken tarihi bugüne çekmek ister misiniz?",
  stampNowLabel: "Tarihi bugüne çek",
  keepLabel: "Olduğu gibi gönder",
  cancelLabel: "Vazgeç",
} as const;

type AlertButton = { text?: string; style?: string; onPress?: () => void };
type AlertFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

/** Alert ile Tarihi bugüne çek / Olduğu gibi gönder. */
export function askInvoiceDatePrompt(
  onChoice: (choice: InvoiceDatePromptChoice) => void,
  ask: AlertFn,
): void {
  ask(INVOICE_DATE_PROMPT.title, INVOICE_DATE_PROMPT.message, [
    { text: INVOICE_DATE_PROMPT.cancelLabel, style: "cancel" },
    { text: INVOICE_DATE_PROMPT.keepLabel, onPress: () => onChoice("keep") },
    { text: INVOICE_DATE_PROMPT.stampNowLabel, onPress: () => onChoice("stamp_now") },
  ]);
}
