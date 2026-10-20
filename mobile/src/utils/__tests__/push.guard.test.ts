import { guardedNotificationHref } from "../push";

const staff = {
  id: "staff-1",
  role: "personel",
  permissions: { "/": "view", "/mesai": "view" },
};

const admin = {
  id: "admin-1",
  role: "admin",
  permissions: {},
};

describe("guardedNotificationHref", () => {
  it("sends staff to the notification list for an edoc target", () => {
    expect(guardedNotificationHref({ target_route: "/edoc-inbox" }, staff, "co-1")).toBe("/notifications");
  });

  it("lets an admin open the edoc inbox", () => {
    expect(guardedNotificationHref({ target_route: "/edoc-inbox" }, admin, "co-1")).toBe("/edoc-inbox");
  });

  it("fails closed when the path cannot be resolved", () => {
    expect(guardedNotificationHref({ target_route: "/no-such-module" }, admin, "co-1")).toBe("/notifications");
    expect(guardedNotificationHref({ link: "/secret-admin" }, admin, "co-1")).toBe("/notifications");
  });

  it("ignores a notification addressed to a different user", () => {
    expect(guardedNotificationHref(
      { target_route: "/edoc-inbox", user_id: "admin-1" },
      staff,
      "co-1",
    )).toBeNull();
    expect(guardedNotificationHref(
      { target_route: "/edoc-inbox", user_id: "admin-1" },
      { _id: "someone-else", role: "admin" },
      "co-1",
    )).toBeNull();
  });

  it("ignores a notification for a different company", () => {
    expect(guardedNotificationHref(
      { target_route: "/edoc-inbox", company_id: "other-co" },
      admin,
      "co-1",
    )).toBeNull();
  });

  it("keeps an old payload without user_id and only checks permission", () => {
    expect(guardedNotificationHref({ target_route: "/edoc-inbox" }, staff, "co-1")).toBe("/notifications");
    expect(guardedNotificationHref(
      { target_route: "/edoc-inbox", user_id: "admin-1", company_id: "co-1" },
      admin,
      "co-1",
    )).toBe("/edoc-inbox");
  });

  it("does not navigate when the session user is missing", () => {
    expect(guardedNotificationHref({ target_route: "/edoc-inbox" }, null, "co-1")).toBeNull();
    expect(guardedNotificationHref({ target_route: "/" }, null, "co-1")).toBeNull();
  });

  it("always allows the notification list and home", () => {
    expect(guardedNotificationHref({ target_route: "/notifications" }, staff, "co-1")).toBe("/notifications");
    expect(guardedNotificationHref({ target_route: "/" }, staff, "co-1")).toBe("/");
  });
});
