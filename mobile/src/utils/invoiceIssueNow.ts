/** Yerel fatura düzenleme tarihi/saati (GİB IssueDate / IssueTime). */
export function nowIssueDateTime(now = new Date()) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return {
    issue_date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    issue_time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
  };
}

export function formatIssueStamp(dateYmd?: string | null, timeHms?: string | null): string {
  const d = String(dateYmd || "").slice(0, 10);
  const t = String(timeHms || "").slice(0, 8);
  if (!d) return t || "—";
  const [y, m, day] = d.split("-");
  const tr = y && m && day ? `${day}.${m}.${y}` : d;
  return t ? `${tr} ${t.slice(0, 5)}` : tr;
}

/** Tek fatura GİB kesiminde tarih/saat «Şimdi» seçeneği. Toplu ve yazdırmada yok. */
export function showEfaturaStampNow({
  isBulk = false,
  isPrint = false,
  mode = "send",
}: {
  isBulk?: boolean;
  isPrint?: boolean;
  mode?: string;
} = {}): boolean {
  return !isPrint && !isBulk && (mode || "send") === "send";
}
