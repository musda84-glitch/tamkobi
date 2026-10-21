function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function duePassed(row, today) {
  const due = String(row?.due_date || "");
  return Boolean(due) && due < String(today || "");
}

/** Vadesi gelmemiş, karşılıksız olmayan ciro ile gelen çekler. */
export function endorsedIncomingOpen(rows, today) {
  const day = today || utcToday();
  return (rows || []).filter((row) => (
    row?.role === "endorsee"
    && (row?.status || "") === "endorsed"
    && !duePassed(row, day)
  ));
}

/** Açık alınan − açık verilen + ciro ile gelen (vadesi gelmemiş). Aktarım snapshot'ı yok sayılır. */
export function openChequeBalance(rows, today) {
  const day = today || utcToday();
  let received = 0;
  let issued = 0;
  let endorsedIn = 0;
  for (const row of rows || []) {
    const amount = Number(row?.amount) || 0;
    if (row?.role === "endorsee") {
      if ((row?.status || "") === "endorsed" && !duePassed(row, day)) endorsedIn += amount;
      continue;
    }
    if ((row?.status || "open") !== "open") continue;
    if (row?.direction === "received") received += amount;
    else if (row?.direction === "issued") issued += amount;
  }
  return Math.round((received - issued + endorsedIn) * 100) / 100;
}
