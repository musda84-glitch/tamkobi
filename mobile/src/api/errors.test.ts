import { apiErrorMessage } from "./errors";

describe("apiErrorMessage", () => {
  it("reads FastAPI string detail", () => {
    expect(apiErrorMessage({ response: { data: { detail: "E-posta adresi veya şifre hatalı." } } })).toBe(
      "E-posta adresi veya şifre hatalı."
    );
  });

  it("joins validation arrays", () => {
    expect(apiErrorMessage({ detail: [{ msg: "field required" }, { msg: "too short" }] })).toBe(
      "field required too short"
    );
  });

  it("falls back", () => {
    expect(apiErrorMessage(null, "Yok")).toBe("Yok");
  });

  it("explains transport failures instead of leaking fetch wording", () => {
    for (const message of ["Failed to fetch", "Network request failed", "Load failed"]) {
      expect(apiErrorMessage({ message }, "Giriş yapılamadı.")).toMatch(/Sunucuya ulaşılamadı/);
    }
  });
});
