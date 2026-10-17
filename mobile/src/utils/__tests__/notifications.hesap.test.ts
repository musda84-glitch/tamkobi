import { mobileTargetHref, notificationRoute } from "../notifications";
import { resolveMobilePath } from "../quickMenu";

describe("hesap and gib credit notification routes", () => {
  it("maps /hesap and gib_credits onto a mobile screen", () => {
    const fromLink = notificationRoute({ link: "/hesap" });
    const fromRef = notificationRoute({ ref_type: "gib_credits" });
    expect(fromLink).toBeTruthy();
    expect(fromRef).toBeTruthy();
    expect(fromLink).toBe(resolveMobilePath("/hesap"));
    expect(fromRef).toBe("/settings");
    expect(mobileTargetHref("/hesap")).toBe(fromLink);
    expect(notificationRoute({ link: "/hesap?tab=kontor", ref_type: "gib_credits" })).toBeTruthy();
  });
});
