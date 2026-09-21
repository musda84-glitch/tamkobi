import { isExpoPushToken, isPushPermissionGranted, notificationHref, shouldAskPushOnOpen } from "./push";

describe("push helpers", () => {
  it("asks permission on iOS/Android open, not web", () => {
    expect(shouldAskPushOnOpen("ios")).toBe(true);
    expect(shouldAskPushOnOpen("android")).toBe(true);
    expect(shouldAskPushOnOpen("web")).toBe(false);
  });

  it("treats granted status as allowed", () => {
    expect(isPushPermissionGranted({ status: "granted" })).toBe(true);
    expect(isPushPermissionGranted({ granted: true })).toBe(true);
    expect(isPushPermissionGranted({ status: "denied" })).toBe(false);
    expect(isPushPermissionGranted(null)).toBe(false);
  });

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
