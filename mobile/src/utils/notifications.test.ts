import {
  latestNotifications,
  notificationAge,
  notificationLook,
  notificationRoute,
  notificationTitle,
  unreadCount,
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
    expect(notificationRoute({ ref_type: "cash_approval" })).toBe("/banking");
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
