import { localPushContent, notificationKey, planLocalPush } from "./pushLocal";

const n = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  message: `msg ${id}`,
  created_at,
  is_read: false,
  ...extra,
});

describe("planLocalPush", () => {
  it("replays newest unread on first seed and marks them seen", () => {
    const rows = [
      n("old", "2026-09-01T10:00:00Z"),
      n("new", "2026-09-21T10:00:00Z"),
      n("mid", "2026-09-10T10:00:00Z"),
      { id: "read", is_read: true, created_at: "2026-09-22T10:00:00Z" },
    ];
    const plan = planLocalPush(rows, [], false, 2);
    expect(plan.seeded).toBe(true);
    expect(plan.alerts.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(plan.nextSeen).toEqual(expect.arrayContaining(["old", "new", "mid"]));
  });

  it("after seed only alerts unseen unread", () => {
    const plan = planLocalPush(
      [n("a", "2026-09-21T10:00:00Z"), n("b", "2026-09-22T10:00:00Z")],
      ["a"],
      true,
    );
    expect(plan.alerts.map((r) => r.id)).toEqual(["b"]);
    expect(plan.nextSeen).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("skips rows without an id", () => {
    const plan = planLocalPush([{ title: "yok", is_read: false }], [], false);
    expect(plan.alerts).toEqual([]);
    expect(plan.seeded).toBe(true);
  });
});

describe("localPushContent", () => {
  it("maps title body and tap data", () => {
    expect(notificationKey({ _id: "x" })).toBe("x");
    expect(localPushContent({
      id: "n1",
      title: "Sipariş",
      message: "Yeni B2B",
      type: "b2b_order",
      link: "/orders",
    })).toEqual({
      title: "Sipariş",
      body: "Yeni B2B",
      data: { type: "b2b_order", link: "/orders", notification_id: "n1" },
    });
  });
});
