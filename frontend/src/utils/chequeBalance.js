/** Açık alınan çek/senet eksi açık verilen. Aktarım snapshot'ı yok sayılır. */
export function openChequeBalance(rows) {
  let received = 0;
  let issued = 0;
  for (const row of rows || []) {
    if ((row?.status || "open") !== "open") continue;
    const amount = Number(row?.amount) || 0;
    if (row?.direction === "received") received += amount;
    else if (row?.direction === "issued") issued += amount;
  }
  return Math.round((received - issued) * 100) / 100;
}
