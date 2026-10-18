import { homeStartPageKey, parseHomeStartPage, startPageIndex } from "./homeStartPage";

describe("homeStartPage", () => {
  it("treats anything other than tiles as overview", () => {
    expect(parseHomeStartPage(null)).toBe("overview");
    expect(parseHomeStartPage("")).toBe("overview");
    expect(parseHomeStartPage("x")).toBe("overview");
    expect(parseHomeStartPage("overview")).toBe("overview");
    expect(parseHomeStartPage("tiles")).toBe("tiles");
    expect(startPageIndex("overview")).toBe(0);
    expect(startPageIndex("tiles")).toBe(1);
  });

  it("keeps a different key per user and company", () => {
    const a = homeStartPageKey("uid-1", "cid-1");
    const b = homeStartPageKey("uid-1", "cid-2");
    const c = homeStartPageKey("uid-2", "cid-1");
    expect(a).toContain("uid-1");
    expect(a).toContain("cid-1");
    expect(a).toBe("tamkobi.home.start_page.v1:uid-1:cid-1");
    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(b).toContain("cid-2");
    expect(c).toContain("uid-2");
  });
});
