import { localizeNotificationText } from "./notificationText";

describe("localizeNotificationText", () => {
  test("translates English decision words in stored notification copy", () => {
    expect(localizeNotificationText("Davut — approved.")).toBe("Davut — onaylandı.");
    expect(localizeNotificationText("Davut — rejected.")).toBe("Davut — reddedildi.");
    expect(localizeNotificationText("Onaylandı")).toBe("Onaylandı");
  });
});
