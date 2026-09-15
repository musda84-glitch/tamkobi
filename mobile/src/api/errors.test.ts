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
    expect(apiErrorMessage({ message: "Network request failed" }, "Bağlantı yok")).toBe("Bağlantı yok");
  });
});
