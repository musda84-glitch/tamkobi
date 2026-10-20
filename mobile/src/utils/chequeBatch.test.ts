import {
  CHEQUE_BATCH_LIMIT,
  addBatchItem,
  appendScannedCheque,
  batchDueLabel,
  batchItemErrorIndex,
  batchTotal,
  chequeBatchPayload,
  nextChequeDraft,
  removeBatchItem,
  updateBatchItem,
  type ChequeBatchItem,
} from "./chequeBatch";
import { emptyChequeDraft, type ChequeDraft } from "./cheques";

function draft(patch: Partial<ChequeDraft> = {}): ChequeDraft {
  return {
    ...emptyChequeDraft("2026-10-20"),
    contact_id: "c1",
    contact_name: "Acme",
    amount: "10",
    due_date: "2026-11-01",
    ...patch,
  };
}

describe("chequeBatch", () => {
  it("adds, updates, removes and totals draft rows", () => {
    let items: ChequeBatchItem[] = [];
    items = addBatchItem(items, draft({ amount: "10", serial_no: "A" }));
    items = addBatchItem(items, draft({ amount: "20.5", serial_no: "B" }), "scan");
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("manual");
    expect(items[1].source).toBe("scan");
    expect(items[0].id).not.toBe(items[1].id);
    expect(batchTotal(items)).toBe(30.5);

    const edited = updateBatchItem(items, 0, { ...items[0].draft, amount: "5" });
    expect(edited).not.toBe(items);
    expect(edited[0].draft.amount).toBe("5");
    expect(items[0].draft.amount).toBe("10");
    expect(batchTotal(edited)).toBe(25.5);
    expect(updateBatchItem(edited, 9, edited[0].draft)).toBe(edited);

    const removed = removeBatchItem(edited, 1);
    expect(removed).toHaveLength(1);
    expect(removed[0].draft.serial_no).toBe("A");
    expect(batchTotal(removed)).toBe(5);
    expect(removeBatchItem(removed, -1)).toBe(removed);
  });

  it("builds a shared contact and direction payload and omits a blank issue date", () => {
    const body = chequeBatchPayload(
      [
        draft({ instrument: "cheque", amount: "10", serial_no: "S1", bank_name: "Garanti", drawer_name: "", issue_date: "" }),
        draft({
          instrument: "promissory",
          amount: "15,5",
          due_date: "2026-12-01",
          issue_date: "2026-10-01",
          serial_no: "P1",
          drawer_name: "Ali",
          notes: "ikinci",
        }),
      ],
      { contact_id: "c1", contact_name: "Acme" },
      "received",
      "co-1",
    );
    expect(body.company_id).toBe("co-1");
    expect(body.contact_id).toBe("c1");
    expect(body.direction).toBe("received");
    expect(body).not.toHaveProperty("notes");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      instrument: "cheque",
      amount: 10,
      due_date: "2026-11-01",
      serial_no: "S1",
      bank_name: "Garanti",
      bank_branch: "",
      account_no: "",
      drawer_name: "",
      notes: "",
    });
    expect(body.items[0]).not.toHaveProperty("issue_date");
    expect(body.items[0]).not.toHaveProperty("contact_id");
    expect(body.items[0]).not.toHaveProperty("direction");
    expect(body.items[0]).not.toHaveProperty("company_id");
    expect(body.items[1]).toMatchObject({
      instrument: "promissory",
      amount: 15.5,
      due_date: "2026-12-01",
      issue_date: "2026-10-01",
      serial_no: "P1",
      drawer_name: "Ali",
      notes: "ikinci",
    });
    const cleared = nextChequeDraft(draft({ instrument: "promissory", direction: "issued", amount: "9", serial_no: "X" }), "2026-10-20");
    expect(cleared).toMatchObject({ contact_id: "c1", direction: "issued", instrument: "promissory", amount: "", serial_no: "", issue_date: "" });
    expect(batchDueLabel([{ due_date: "2026-11-01" }, { due_date: "2026-12-01" }])).toBe("01.11.2026 – 01.12.2026");
  });

  it("stops at 50 items", () => {
    let items: ChequeBatchItem[] = [];
    const row = draft({ amount: "1" });
    for (let i = 0; i < CHEQUE_BATCH_LIMIT; i += 1) items = addBatchItem(items, row);
    expect(items).toHaveLength(50);
    expect(addBatchItem(items, row)).toBe(items);
    expect(batchTotal(items)).toBe(50);
    const scanned = appendScannedCheque(items, { amount: 80, due_date: "2026-12-01", serial_no: "SCAN" }, {
      contact_id: "c1",
      contact_name: "Acme",
      direction: "received",
    });
    expect(scanned.items).toBe(items);
    expect(scanned.error).toMatch(/50/);
  });

  it("reads a 0-based index from a Kalem 2 error", () => {
    expect(batchItemErrorIndex("Kalem 2: vade hatalı")).toBe(2);
    expect(batchItemErrorIndex(new Error("Kalem 2: tutar sıfırdan büyük olmalı."))).toBe(2);
    expect(batchItemErrorIndex({ response: { data: { detail: "Kalem 2: banka eksik" } } })).toBe(2);
    expect(batchItemErrorIndex({ detail: "Kalem 0: geçersiz." })).toBe(0);
    expect(batchItemErrorIndex("Kalem sayısı 1 ile 50 arasında olmalı.")).toBeNull();
    expect(batchItemErrorIndex("Cari seçin.")).toBeNull();
  });
});
