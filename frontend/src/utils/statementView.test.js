import {
  filterStatementRows,
  sortStatementRows,
  statementDocType,
  statementDocTypeOptions,
  statementFiltersActive,
  statementGibState,
  statementTotals,
  statementView,
} from "./statementView";

const rows = [
  { date: "2026-10-01", doc: "SF-1 • Satış Faturası", debit: 100, credit: 0, balance: 100, kind: "invoice", einvoice_state: "sent", e_type: "e_invoice" },
  { date: "2026-10-01", doc: "SF-2 • Satış Faturası", debit: 40, credit: 0, balance: 140, kind: "invoice", einvoice_state: "draft", e_type: "e_archive" },
  { date: "2026-10-02T15:00:00", doc: "AF-1 • Alış Faturası", debit: 0, credit: 25, balance: 115, kind: "invoice", einvoice_state: "queued", e_type: "e_invoice" },
  { date: "2026-10-03", doc: "Tahsilat • Kasa • İade nakit", debit: 0, credit: 15, balance: 100, kind: "payment" },
  { date: "2026-10-04", doc: "Ödeme • Banka", debit: 10, credit: "", balance: 110, kind: "payment" },
  { date: "2026-10-05", doc: "Alınan Çek • SN2", debit: 0, credit: 5, balance: 105, kind: "cheque" },
  { date: "2026-10-06", doc: "Verilen Senet • S1", debit: 8, credit: 0, balance: 113, kind: "cheque" },
  { date: "2026-10-07", doc: "Borç fişi", debit: 3, credit: 0, balance: 116, kind: "ledger" },
  { date: "2026-10-08", doc: "Hatalı • Satış Faturası", debit: 2, credit: 0, balance: 118, kind: "invoice", einvoice_state: "error", e_type: "e_invoice" },
  { date: "2026-10-09", doc: "Matbu • Satış Faturası", debit: 4, credit: 0, balance: 122, kind: "invoice", einvoice_state: "paper", e_type: "paper" },
  { date: "2026-10-10", doc: "ISIK lambası", debit: 1, credit: 0, balance: 123, kind: "payment" },
];

test("sıralama her anahtarda asc/desc, eşitlikte orijinal sıra korunur", () => {
  ["date", "doc", "debit", "credit", "balance"].forEach((key) => {
    const asc = sortStatementRows(rows, { key, dir: "asc" });
    const desc = sortStatementRows(rows, { key, dir: "desc" });
    expect(asc).toHaveLength(rows.length);
    expect(desc).toHaveLength(rows.length);
    expect(asc[0]).not.toBe(desc[0]);
    asc.forEach((row) => expect(rows).toContain(row));
    desc.forEach((row) => expect(row.balance).toBe(rows.find((item) => item.doc === row.doc).balance));
  });

  const sameDay = sortStatementRows(rows, { key: "date", dir: "desc" });
  const firstDay = sameDay.filter((r) => String(r.date).slice(0, 10) === "2026-10-01");
  expect(firstDay.map((r) => r.doc)).toEqual(["SF-1 • Satış Faturası", "SF-2 • Satış Faturası"]);

  const tied = [
    { date: "2026-10-02", doc: "b", balance: 5, debit: 0, credit: 0, kind: "payment" },
    { date: "2026-10-01", doc: "a", balance: 5, debit: 0, credit: 0, kind: "invoice" },
  ];
  expect(sortStatementRows(tied, { key: "balance", dir: "asc" }).map((r) => r.doc)).toEqual(["b", "a"]);
  expect(sortStatementRows(tied, { key: "balance", dir: "desc" }).map((r) => r.doc)).toEqual(["b", "a"]);
  expect(sortStatementRows(tied, { key: "balance", dir: "desc" })[0]).toBe(tied[0]);

  expect(sortStatementRows(rows, { key: "debit", dir: "asc" })[0].debit || 0).toBe(0);
  expect(sortStatementRows(rows, { key: "credit", dir: "desc" })[0].credit).toBe(25);
  expect(sortStatementRows(rows, { key: "balance", dir: "asc" })[0].balance).toBe(100);
  expect(sortStatementRows(rows, { key: "balance", dir: "desc" })[0].balance).toBe(140);
  const byDoc = sortStatementRows(rows, { key: "doc", dir: "asc" }).map((r) => r.doc);
  const sortedDocs = [...byDoc].sort((a, b) => a.toLocaleLowerCase("tr").localeCompare(b.toLocaleLowerCase("tr"), "tr"));
  expect(byDoc).toEqual(sortedDocs);
});

test("tarih aralığı, tür, Türkçe metin ve borç/alacak filtreleri", () => {
  const ranged = filterStatementRows(rows, { from: "2026-10-02", to: "2026-10-03" });
  expect(ranged.map((r) => r.doc)).toEqual(["AF-1 • Alış Faturası", "Tahsilat • Kasa • İade nakit"]);

  expect(filterStatementRows(rows, { docType: "Çek" }).map((r) => r.doc)).toEqual(["Alınan Çek • SN2"]);
  expect(filterStatementRows(rows, { docType: "Senet" }).map((r) => r.doc)).toEqual(["Verilen Senet • S1"]);
  expect(filterStatementRows(rows, { docType: "Borç fişi" }).map((r) => r.kind)).toEqual(["ledger"]);
  expect(statementDocType(rows[0])).toBe("Satış Faturası");
  expect(statementDocType(rows[3])).toBe("Tahsilat");
  expect(statementDocType(rows[4])).toBe("Ödeme");

  const options = statementDocTypeOptions(rows);
  expect(options).toContain("Satış Faturası");
  expect(options).toContain("Alış Faturası");
  expect(options).toContain("Tahsilat");
  expect(options).not.toContain("Fatura");
  expect(statementDocTypeOptions([rows[0]])).toEqual(["Satış Faturası"]);

  expect(filterStatementRows(rows, { q: "iade" }).map((r) => r.doc)).toEqual(["Tahsilat • Kasa • İade nakit"]);
  expect(filterStatementRows(rows, { q: "ısık" }).map((r) => r.doc)).toEqual(["ISIK lambası"]);
  expect(filterStatementRows([{ doc: "ıslak imza", date: "2026-10-01", kind: "payment" }], { q: "ISLAK" })).toHaveLength(1);

  expect(filterStatementRows(rows, { side: "debit" }).every((r) => Number(r.debit) > 0)).toBe(true);
  expect(filterStatementRows(rows, { side: "credit" }).every((r) => Number(r.credit) > 0)).toBe(true);
  expect(filterStatementRows(rows, { side: "credit", q: "kasa" })).toHaveLength(1);
});

test("toplamlar ve filtre/sıralama bakiyeyi yeniden hesaplamaz", () => {
  const credit = filterStatementRows(rows, { side: "credit" });
  const totals = statementTotals(credit);
  expect(totals.credit).toBe(25 + 15 + 5);
  expect(totals.debit).toBe(0);
  expect(totals.net).toBe(-(25 + 15 + 5));
  expect(totals.count).toBe(3);

  const viewed = statementView(rows, { q: "sf-1", side: "debit" }, { key: "balance", dir: "desc" });
  expect(viewed).toHaveLength(1);
  expect(viewed[0]).toBe(rows[0]);
  expect(viewed[0].balance).toBe(100);

  const sorted = sortStatementRows(rows, { key: "date", dir: "desc" });
  sorted.forEach((row) => {
    expect(row.balance).toBe(rows.find((item) => item.doc === row.doc).balance);
  });
  expect(statementFiltersActive({})).toBe(false);
  expect(statementFiltersActive({ q: "a" })).toBe(true);
  expect(statementFiltersActive({ gib: "unsent" })).toBe(true);
});

test("statementGibState ve GİB filtresi", () => {
  const label = (state, eType = "e_invoice") => statementGibState({ kind: "invoice", einvoice_state: state, e_type: eType });
  expect(label("sent").label).toBe("GİB");
  expect(label("accepted").label).toBe("GİB");
  expect(label("received", "e_archive").label).toBe("GİB");
  expect(label("received", "e_archive").eLabel).toBe("e-Arşiv");
  expect(label("sent").eLabel).toBe("e-Fatura");
  expect(label("sent").className).toMatch(/emerald/);
  expect(label("draft").label).toBe("Kesilmedi");
  expect(label("").label).toBe("Kesilmedi");
  expect(statementGibState({ kind: "invoice" }).label).toBe("Kesilmedi");
  expect(label("queued").label).toBe("Kuyrukta");
  expect(label("pending").className).toMatch(/amber/);
  expect(label("error").label).toBe("Hata");
  expect(label("error").className).toMatch(/rose/);
  expect(label("paper", "paper").label).toBe("Matbu");
  expect(statementGibState({ kind: "invoice", einvoice_state: "sent", e_type: "paper" }).key).toBe("paper");
  expect(statementGibState({ kind: "invoice", gib: "sent", e_type: "e_archive" }).label).toBe("GİB");
  expect(statementGibState({ kind: "payment", einvoice_state: "sent" })).toBeNull();

  const unsent = filterStatementRows(rows, { gib: "unsent" }).map((r) => r.einvoice_state);
  expect(unsent).toEqual(["draft", "queued", "error"]);
  expect(filterStatementRows(rows, { gib: "sent" }).map((r) => r.einvoice_state)).toEqual(["sent"]);
  expect(filterStatementRows(rows, { gib: "sent" }).every((r) => r.balance === rows.find((item) => item.doc === r.doc).balance)).toBe(true);
});
