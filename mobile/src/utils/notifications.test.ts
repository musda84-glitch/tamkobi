import {
  latestNotifications,
  localizeNotificationText,
  notificationAge,
  notificationLook,
  notificationRoute,
  notificationText,
  notificationTitle,
  liveBadgeCounts,
  tileBadgeLabel,
  tileBadges,
  unreadByTile,
  unreadFromBadges,
  unreadCount,
  visibleNotifications,
} from "./notifications";

const at = (iso: string) => ({ created_at: iso });

describe("latestNotifications", () => {
  it("keeps the three newest records regardless of server order", () => {
    const rows = [at("2026-09-10T10:00:00Z"), at("2026-09-18T10:00:00Z"), at("2026-09-12T10:00:00Z"), at("2026-09-17T10:00:00Z")];
    expect(latestNotifications(rows).map((n) => n.created_at)).toEqual([
      "2026-09-18T10:00:00Z",
      "2026-09-17T10:00:00Z",
      "2026-09-12T10:00:00Z",
    ]);
  });

  it("tolerates missing and malformed dates", () => {
    expect(latestNotifications(null)).toEqual([]);
    expect(latestNotifications([{ title: "a" }, at("2026-09-18T10:00:00Z")], 1)[0].created_at).toBe("2026-09-18T10:00:00Z");
  });
});

describe("unreadCount", () => {
  it("counts only unread rows", () => {
    expect(unreadCount([{ is_read: true }, {}, { is_read: false }])).toBe(2);
    expect(unreadCount(undefined)).toBe(0);
  });
});

describe("tileBadges", () => {
  it("maps unread notes and live pending work onto home tiles", () => {
    expect(unreadByTile([
      { type: "b2b_order", is_read: false },
      { type: "b2b_order_edit", is_read: false },
      { type: "leave_request", is_read: false },
      { type: "bank_sync", is_read: true },
      { type: "cash_approval", is_read: false },
      { type: "order_pick_missing", is_read: false },
      { type: "order_pick_production", is_read: false },
    ])).toEqual({ orders: 2, sevk: 2, personnel: 1, banking: 1 });
    expect(tileBadgeLabel(0, 3)).toBe("3");
    expect(tileBadgeLabel(120)).toBe("99+");
    expect(tileBadges(
      [{ type: "b2b_order", is_read: false }, { type: "order_pick_missing", is_read: false }],
      { orders: 5, personnel: 2, banking: 0, sevk: 8, atolye: 4 },
    )).toEqual({ orders: "5", sevk: "8", personnel: "2", atolye: "4" });
  });

  it("hides a tile when live work is zero even if unread notes remain", () => {
    expect(tileBadges(
      [{ type: "b2b_order", is_read: false }, { type: "b2b_order", is_read: false }, { type: "b2b_order", is_read: false }],
      { orders: 0 },
    )).toEqual({});
  });
});

describe("liveBadgeCounts", () => {
  it("reads the cheap tile-badges payload", () => {
    expect(liveBadgeCounts({ orders: 4, sevk: 0, unread: 9 })).toEqual({
      orders: 4, sevk: 0, personnel: 0, banking: 0, atolye: 0, edoc: 0,
    });
    expect(unreadFromBadges({ unread: 9 })).toBe(9);
  });
});

describe("notificationText", () => {
  it("translates English decision words in stored copy", () => {
    expect(localizeNotificationText("Davut — approved.")).toBe("Davut — onaylandı.");
    expect(notificationText({ message: "Davut — approved." })).toBe("Davut — onaylandı.");
    expect(notificationLook({ title: "Giriş onaylandı", message: "Davut — approved." }).tone).toBe("emerald");
  });
});

describe("notificationLook", () => {
  it("separates approvals from rejections like the web bell", () => {
    expect(notificationLook({ title: "TKL-2026-001 ONAYLANDI" }).tone).toBe("emerald");
    expect(notificationLook({ title: "TKL-2026-001 REDDEDİLDİ" }).tone).toBe("rose");
    expect(notificationLook({ title: "İptal talebi SIP-12" }).tone).toBe("rose");
  });

  it("falls back to the notification type", () => {
    expect(notificationLook({ type: "b2b_order", title: "Yeni B2B siparişi" }).icon).toBe("cart");
    expect(notificationLook({ type: "cash_approval", title: "Kasa işlemi bekliyor" }).icon).toBe("wallet");
    expect(notificationLook({ type: "other", title: "Duyuru" }).icon).toBe("information-circle");
    expect(notificationLook({ type: "role_assigned", title: "Rol atandı: Depo" }).tone).toBe("violet");
    expect(notificationLook({ type: "overtime_assigned" }).icon).toBe("time");
  });
});

describe("visibleNotifications", () => {
  it("keeps role-matched and personal rows for warehouse staff", () => {
    const rows = [
      { type: "order_pick_missing", title: "depo" },
      { type: "attendance_late", title: "geç" },
      { type: "task_assigned", title: "görev", user_id: "u1", roles: [] },
      { type: "role_assigned", title: "rol", user_id: "u1" },
    ];
    const user = { id: "u1", email: "w@x", name: "Ali", role: "warehouse" };
    expect(visibleNotifications(rows, user).map((n) => n.title)).toEqual(["depo", "görev", "rol"]);
    expect(visibleNotifications(rows, { ...user, role: "admin" })).toHaveLength(4);
    expect(visibleNotifications(rows, { ...user, role: "admin", employee_id: "e1" }).map((n) => n.title)).toEqual(["görev", "rol"]);
  });
});

describe("notificationRoute", () => {
  it("prefers the backend link and keeps its query", () => {
    expect(notificationRoute({ link: "/banking?tab=partners" })).toBe("/banking?tab=partners");
    expect(notificationRoute({ link: "/stock" })).toBe("/stok");
  });

  it("maps ref_type when there is no mobile route for the link", () => {
    expect(notificationRoute({ link: "/support", ref_type: "quote" })).toBe("/quotes");
    expect(notificationRoute({ ref_type: "order" })).toBe("/orders");
    expect(notificationRoute({ ref_type: "order_pick" })).toBe("/sevk");
    expect(notificationRoute({ link: "/atolye" })).toBe("/atolye");
    expect(notificationRoute({ link: "/production" })).toBe("/atolye");
    expect(notificationRoute({ ref_type: "work_order" })).toBe("/atolye");
    expect(notificationRoute({ ref_type: "cash_approval" })).toBe("/banking");
    expect(notificationRoute({ link: "/edoc-inbox", ref_type: "edoc" })).toBe("/edoc-inbox");
    expect(notificationRoute({ type: "announcement" })).toBeNull();
  });
});

describe("notificationAge", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("shortens the timestamp", () => {
    expect(notificationAge("2026-09-18T11:59:40Z", now)).toBe("şimdi");
    expect(notificationAge("2026-09-18T11:25:00Z", now)).toBe("35 dk");
    expect(notificationAge("2026-09-18T09:00:00Z", now)).toBe("3 sa");
    expect(notificationAge("2026-09-16T12:00:00Z", now)).toBe("2 gn");
    expect(notificationAge("2026-09-01T12:00:00Z", now)).toBe("2 hf");
    expect(notificationAge(null, now)).toBe("");
  });
});

describe("notificationTitle", () => {
  it("never renders an empty header", () => {
    expect(notificationTitle({})).toBe("Bildirim");
    expect(notificationTitle({ type: "b2b_order" })).toBe("b2b_order");
  });
});
