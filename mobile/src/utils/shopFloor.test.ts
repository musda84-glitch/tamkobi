import {
  employeeLabel,
  finishQtyError,
  isMine,
  isOpenStatus,
  mergeSelfEmployee,
  openWorkOrderCount,
  partitionWorkOrders,
  readyCount,
  runningCount,
  todayDoneCount,
  woCardKey,
  woStatusTone,
  woStatusTr,
  type WorkOrder,
} from "./shopFloor";

const wo = (partial: WorkOrder): WorkOrder => ({ id: partial.id || "w1", ...partial });

describe("woStatusTr / tone", () => {
  it("matches the web shop-floor labels", () => {
    expect(woStatusTr("waiting")).toBe("Bekliyor");
    expect(woStatusTr("ready")).toBe("Hazır");
    expect(woStatusTr("in_progress")).toBe("Devam Ediyor");
    expect(woStatusTr("paused")).toBe("Duraklatıldı");
    expect(woStatusTr("done")).toBe("Tamamlandı");
    expect(woStatusTr(null)).toBe("Bekliyor");
    expect(woStatusTr("custom")).toBe("custom");
  });

  it("picks badge tones like Depo Sevkiyat", () => {
    expect(woStatusTone("done")).toBe("green");
    expect(woStatusTone("ready")).toBe("indigo");
    expect(woStatusTone("in_progress")).toBe("amber");
    expect(woStatusTone("paused")).toBe("amber");
    expect(woStatusTone("waiting")).toBe("slate");
  });
});

describe("partitionWorkOrders", () => {
  const rows: WorkOrder[] = [
    wo({ id: "a", status: "ready", step_name: "Kesim" }),
    wo({ id: "b", status: "in_progress", operator_name: "Ali", step_name: "Montaj" }),
    wo({ id: "c", status: "paused", assigned_name: "Ali", step_name: "Paket" }),
    wo({ id: "d", status: "waiting", step_name: "Boya" }),
    wo({ id: "e", status: "done", step_name: "Kontrol" }),
  ];

  it("splits mine / active / waiting / done like the web kiosk", () => {
    const p = partitionWorkOrders(rows, "Ali");
    expect(p.mine.map((w) => w.id)).toEqual(["b", "c"]);
    expect(p.others.map((w) => w.id)).toEqual(["a"]);
    expect(p.active.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(p.waiting.map((w) => w.id)).toEqual(["d"]);
    expect(p.done.map((w) => w.id)).toEqual(["e"]);
  });

  it("keeps mine empty until an operator is unlocked", () => {
    expect(partitionWorkOrders(rows, "").mine).toEqual([]);
    expect(isMine(rows[1], "")).toBe(false);
    expect(isMine(rows[1], "Ali")).toBe(true);
    expect(isOpenStatus("ready")).toBe(true);
    expect(isOpenStatus("waiting")).toBe(false);
  });
});

describe("shop-floor KPIs", () => {
  it("counts ready, running and today's finished steps", () => {
    const rows: WorkOrder[] = [
      wo({ id: "1", status: "ready" }),
      wo({ id: "2", status: "in_progress" }),
      wo({ id: "3", status: "paused" }),
      wo({ id: "4", status: "done", finished_at: "2026-09-19T08:00:00Z" }),
      wo({ id: "5", status: "done", finished_at: "2026-09-18T22:00:00Z" }),
      wo({ id: "6", status: "waiting" }),
    ];
    expect(readyCount(rows)).toBe(1);
    expect(runningCount(rows)).toBe(2);
    expect(todayDoneCount(rows, "2026-09-19")).toBe(1);
    expect(openWorkOrderCount(rows)).toBe(3);
    expect(openWorkOrderCount(null)).toBe(0);
  });
});

describe("finishQtyError", () => {
  it("rejects negative or over-plan quantities", () => {
    expect(finishQtyError(2, 0, 2)).toBeNull();
    expect(finishQtyError(1.5, 0.5, 2)).toBeNull();
    expect(finishQtyError(-1, 0, 2)).toBe("Miktar negatif olamaz.");
    expect(finishQtyError(2, 1, 2)).toMatch(/planlanan miktarı/);
  });
});

describe("employees", () => {
  it("labels the operator the same way as the web select", () => {
    expect(employeeLabel({ full_name: "Ali", position: "Tornacı" })).toBe("Ali — Tornacı");
    expect(employeeLabel({ full_name: "Veli" })).toBe("Veli");
  });

  it("prepends the signed-in card when /personnel is closed", () => {
    const self = { id: "emp_me", full_name: "Ben" };
    expect(mergeSelfEmployee([], self).map((e) => e.id)).toEqual(["emp_me"]);
    expect(mergeSelfEmployee([{ id: "emp_me", full_name: "Ben" }, { id: "x" }], self)).toHaveLength(2);
    expect(mergeSelfEmployee(null, null)).toEqual([]);
  });
});

describe("woCardKey", () => {
  it("prefers the document id", () => {
    expect(woCardKey({ id: "abc", order_code: "UE-1", step_no: 2 })).toBe("abc");
    expect(woCardKey({ order_code: "UE-1", step_no: 2 })).toBe("UE-1-2");
  });
});
