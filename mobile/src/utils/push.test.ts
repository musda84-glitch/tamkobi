import { isExpoPushToken, notificationHref } from "./push";

describe("push helpers", () => {
  it("accepts Expo tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("fcm:nope")).toBe(false);
  });

  it("maps notification data onto mobile routes", () => {
    expect(notificationHref({ link: "/orders" })).toBe("/orders");
    expect(notificationHref({ link: "/stock" })).toBe("/stok");
    expect(notificationHref({ link: "/personnel?tab=attendance" })).toBe("/personnel?tab=attendance");
    expect(notificationHref({})).toBe("/notifications");
  });
});
