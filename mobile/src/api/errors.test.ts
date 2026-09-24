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

  it("keeps a real API sentence on 502 instead of the generic banner", () => {
    expect(apiErrorMessage({
      status: 502,
      response: { data: { detail: "Fiş okunamadı: Yapay zeka API anahtarı yapılandırılmamış." } },
    }, "Fiş okunamadı.")).toMatch(/anahtarı/);
  });

  it("does not dump nginx HTML from a 502", () => {
    const html = "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>";
    expect(apiErrorMessage({ status: 502, response: { data: { detail: html } } }, "Özet yüklenemedi.")).toMatch(/yanıt vermiyor/);
    expect(apiErrorMessage({ message: html }, "Özet yüklenemedi.")).not.toMatch(/<!DOCTYPE|<html|<head/);
    expect(apiErrorMessage({ status: 503, detail: "Service Unavailable" })).toMatch(/bakımda|yüklü/);
  });
});
