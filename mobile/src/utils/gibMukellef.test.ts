import { ApiHttpError } from "../api/errors";
import {
  clearGibMukellefCache,
  eTypeFromGib,
  faturalastirMenuLabel,
  fetchGibMukellef,
  type GibEntry,
} from "./gibMukellef";

const client = { baseUrl: "https://tamkobi.test", token: "t" };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://tamkobi.test/api/gib/lookup?tax_id=1&company_id=c1",
    redirected: false,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

describe("gibMukellef", () => {
  beforeEach(() => {
    clearGibMukellefCache();
  });

  afterEach(() => {
    clearGibMukellefCache();
    // @ts-expect-error test mock
    global.fetch = undefined;
  });

  it("yer tutucu TCKN e-Arşiv döner ve sorgu atılmaz", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const entry = await fetchGibMukellef(client, "c1", "11111111111");
    expect(entry.status).toBe("ok");
    if (entry.status !== "ok") return;
    expect(eTypeFromGib(entry.data)).toBe("e_archive");
    expect(entry.data.is_e_invoice_user).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mükellef değilse e_archive", async () => {
    // @ts-expect-error test mock
    global.fetch = jest.fn(async () => jsonResponse(200, {
      tax_id: "12345678901",
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
      message: "GİB e-Fatura listesinde kayıtlı değil",
    }));
    const entry = await fetchGibMukellef(client, "c1", "12345678901");
    expect(entry.status).toBe("ok");
    if (entry.status !== "ok") return;
    expect(eTypeFromGib(entry.data)).toBe("e_archive");
  });

  it("mükellefse e_invoice", async () => {
    // @ts-expect-error test mock
    global.fetch = jest.fn(async () => jsonResponse(200, {
      tax_id: "6320984412",
      is_e_invoice_user: true,
      suggested_e_type: "e_invoice",
      alias: "urn:mail:pk@firma",
    }));
    const entry = await fetchGibMukellef(client, "c1", "6320984412");
    expect(entry.status).toBe("ok");
    if (entry.status !== "ok") return;
    expect(eTypeFromGib(entry.data)).toBe("e_invoice");
  });

  it("sorgu hatasında karar yok ve gönder butonu pasif kalır", async () => {
    // @ts-expect-error test mock
    global.fetch = jest.fn(async () => jsonResponse(502, { detail: "İşNet SOAP GİB sorgusu başarısız." }));
    let entry: GibEntry | undefined;
    try {
      await fetchGibMukellef(client, "c1", "6320984412");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiHttpError);
      entry = (err as ApiHttpError & { gibEntry?: GibEntry }).gibEntry;
    }
    expect(entry?.status).toBe("error");
    expect(entry && "data" in entry).toBe(false);
    expect(faturalastirMenuLabel(entry)).toBe("Faturalaştır");
    // ElektronikFaturaOnayModal gönder düğmesini yalnız status === "ok" iken açar.
    expect(entry?.status === "ok").toBe(false);
  });
});
