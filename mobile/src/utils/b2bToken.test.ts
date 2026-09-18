import { parseB2bToken } from "./b2bToken";

describe("parseB2bToken", () => {
  it("reads portal URLs, query flags and raw tokens", () => {
    expect(parseB2bToken("https://tamkobi.com/portal/abc123def4567890")).toBe("abc123def4567890");
    expect(parseB2bToken("/yasal/kvkk?b2b=tokentokentoken12")).toBe("tokentokentoken12");
    expect(parseB2bToken("0123456789abcdef0123456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(parseB2bToken("kısa")).toBeNull();
    expect(parseB2bToken("")).toBeNull();
  });
});
