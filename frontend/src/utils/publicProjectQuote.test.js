import { publicProjectQuoteUrl, publicQuoteStatusLabel } from "./publicProjectQuote";

describe("publicProjectQuote", () => {
  it("builds the public project quote detail path", () => {
    expect(publicProjectQuoteUrl("https://x/api", "tok", "TKF-2026-0014")).toBe(
      "https://x/api/public/projects/tok/quotes/TKF-2026-0014",
    );
  });

  it("prefers approval status on the tracking list", () => {
    expect(publicQuoteStatusLabel({ status: "sent", approval_status: "accepted" })).toBe("Onaylandı");
    expect(publicQuoteStatusLabel({ status: "draft" })).toBe("Hazırlanıyor");
  });
});
