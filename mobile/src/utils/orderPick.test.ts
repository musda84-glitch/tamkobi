import {
  adjustPayload,
  canShip,
  lineRemaining,
  pickPercent,
  pickStatusTone,
  pickStatusTr,
  pickSummaryText,
  pendingPickCount,
  pendingSevkCount,
  scanErrorMessage,
} from "./orderPick";

describe("orderPick", () => {
  it("labels pick statuses like the web kiosk", () => {
    expect(pickStatusTr("picking")).toBe("Toplanıyor");
    expect(pickStatusTr("shipped")).toBe("Sevk edildi");
    expect(pickStatusTr(undefined)).toBe("Bekliyor");
    expect(pickStatusTone("shipped")).toBe("green");
    expect(pickStatusTone("partial")).toBe("amber");
    expect(pickStatusTone("idle")).toBe("slate");
  });

  it("turns progress into a percent and summary", () => {
    expect(pickPercent({ ordered: 10, picked: 4 })).toBe(40);
    expect(pickPercent({ ordered: 0, picked: 0 })).toBe(0);
    expect(pickPercent({ ordered: 3, picked: 9 })).toBe(100);
    expect(pickSummaryText({ ordered: 10, picked: 4, missing_lines: 2 }, 3)).toBe("4/10 adet · 3 kalem · 2 eksik satır");
  });

  it("only allows full shipment when every line is picked", () => {
    expect(canShip({ complete: true })).toBe(true);
    expect(canShip({ complete: false })).toBe(false);
    expect(canShip(null)).toBe(false);
  });

  it("clamps adjust between zero and the ordered quantity", () => {
    const line = { line_index: 2, product_id: "p1", product_name: "Raf", ordered_qty: 5, picked_qty: 1 };
    expect(adjustPayload(line, 3).picked_qty).toBe(3);
    expect(adjustPayload(line, 9).picked_qty).toBe(5);
    expect(adjustPayload(line, -4).picked_qty).toBe(0);
    expect(adjustPayload(line, 3)).toMatchObject({ line_index: 2, product_id: "p1" });
    expect(lineRemaining(line)).toBe(4);
  });

  it("counts waiting picks for the home Depo Sevkiyat badge", () => {
    expect(pendingPickCount([
      { pick_status: "idle", order_status: "approved" },
      { pick_status: "picking", order_status: "preparing" },
      { pick_status: "shipped", order_status: "shipped" },
    ])).toBe(2);
    expect(pendingSevkCount({
      picks: [{ pick_status: "idle" }],
      tasks: [{ key: "pick_missing", path: "/sevk", count: 4 }],
      ops: [{ key: "pick_missing", path: "/sevk", count: 1 }],
    })).toBe(4);
    expect(pendingSevkCount({ picks: [], tasks: [], ops: [] })).toBe(0);
  });

  it("reads the overscan detail the server returns with 409", () => {
    expect(scanErrorMessage({ detail: { code: "overscan", message: "Raf: siparişte 2 adet var." } })).toBe("Raf: siparişte 2 adet var.");
    expect(scanErrorMessage({ detail: { code: "overscan", product_name: "Raf", ordered_qty: 2, picked_qty: 2 } })).toBe(
      "Raf: siparişte 2 adet var, 2 okutuldu."
    );
    expect(scanErrorMessage({ detail: "Bu barkod siparişte yok: 123" })).toBe("Bu barkod siparişte yok: 123");
    expect(scanErrorMessage({}, "Barkod okunamadı.")).toBe("Barkod okunamadı.");
  });
});
