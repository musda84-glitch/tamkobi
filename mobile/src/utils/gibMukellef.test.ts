import { ApiHttpError } from "../api/errors";
import {
  GIB_MUKELLEF_TTL_MS,
  buyerTaxChoice,
  clearGibMukellefCache,
  docBuyerTaxId,
  eTypeFromGib,
  faturalastirMenuLabel,
  fetchGibMukellef,
  gibLookupPresentation,
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

  it("docBuyerTaxId fatura VKN'sini cariden önce alır", () => {
    const doc = { contact_tax_id: "3680486408" };
    const contact = { tax_number_or_id: "12345678901" };
    expect(docBuyerTaxId(doc, contact)).toBe("3680486408");
    expect(buyerTaxChoice(doc, contact).mismatch).toBe(true);
    expect(docBuyerTaxId({ contact_tax_id: "" }, contact)).toBe("12345678901");
  });

  it("bulunamadı mesajı mükellefi e-Arşiv yapmaz; unknown null döner", () => {
    expect(eTypeFromGib({
      is_e_invoice_user: true,
      suggested_e_type: "e_invoice",
      message: "Kayıt bulunamadı",
    })).toBe("e_invoice");
    expect(eTypeFromGib({
      lookup_status: "unknown",
      is_e_invoice_user: false,
      message: "bulunamadı",
    })).toBeNull();
    expect(faturalastirMenuLabel({
      lookup_status: "unknown",
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
    })).toBe("Faturalaştır");
  });

  it("TTL dolunca yeniden sorgular; hata, unknown ve eksik VKN önbelleğe yazılmaz", async () => {
    const now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    const fetchMock = jest.fn(async (url: string) => {
      const tax = decodeURIComponent(String(url).split("tax_id=")[1]?.split("&")[0] || "");
      return jsonResponse(200, {
        tax_id: tax,
        is_e_invoice_user: true,
        suggested_e_type: "e_invoice",
        lookup_status: "mukellef",
        name: "ERSAY HOME",
        source: "isnet",
        alias: "urn:mail:pk@ersay.home",
        aliases: ["urn:mail:pk@ersay.home", "urn:mail:gb@ersay.home"],
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const first = await fetchGibMukellef(client, "c1", "3680486408");
    expect(first.status).toBe("ok");
    if (first.status === "ok") expect(first.expiresAt).toBe(now + GIB_MUKELLEF_TTL_MS);
    await fetchGibMukellef(client, "c1", "3680486408");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(now + GIB_MUKELLEF_TTL_MS);
    await fetchGibMukellef(client, "c1", "3680486408");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(async () => jsonResponse(200, {
      lookup_status: "unknown",
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
      message: "GİB kaydı bulunamadı; mükellefiyet doğrulanamadı.",
    }));
    await expect(fetchGibMukellef(client, "c1", "6320984412")).rejects.toThrow(/doğrulanamadı/);
    await expect(fetchGibMukellef(client, "c1", "6320984412")).rejects.toThrow(/doğrulanamadı/);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const before = fetchMock.mock.calls.length;
    await expect(fetchGibMukellef(client, "c1", "12")).rejects.toThrow("VKN eksik");
    await expect(fetchGibMukellef(client, "c1", "12")).rejects.toThrow("VKN eksik");
    expect(fetchMock).toHaveBeenCalledTimes(before);

    const view = gibLookupPresentation(
      { contact_tax_id: "3680486408" },
      { tax_number_or_id: "12345678901" },
      {
        status: "ok",
        expiresAt: now + GIB_MUKELLEF_TTL_MS,
        data: {
          name: "ERSAY HOME",
          source: "isnet",
          lookup_status: "mukellef",
          aliases: ["urn:mail:pk@ersay.home"],
        },
      },
    );
    expect(view.tax).toBe("3680486408");
    expect(view.mismatch).toBe(true);
    expect(view.name).toBe("ERSAY HOME");
    expect(view.source).toBe("isnet");
    expect(view.aliases).toEqual(["urn:mail:pk@ersay.home"]);
    expect(view.eType).toBe("e_invoice");
    expect(view.blocked).toBe(false);
    const blocked = gibLookupPresentation(
      { contact_tax_id: "3680486408" },
      null,
      { status: "error", error: "GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı." },
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.eType).toBeNull();
    expect(blocked.error).toMatch(/TaxPayer/);
    nowSpy.mockRestore();
  });

  it("yeniden sorgula refresh=1 gönderir", async () => {
    const fetchMock = jest.fn(async (url: string) => jsonResponse(200, {
      tax_id: "3680486408",
      is_e_invoice_user: true,
      suggested_e_type: "e_invoice",
      lookup_status: "mukellef",
      source: "isnet_portal",
      aliases: ["urn:mail:pk@ersay.home"],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchGibMukellef(client, "c1", "3680486408");
    await fetchGibMukellef(client, "c1", "3680486408", { refresh: true });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[1]).toMatch(/refresh=1/);
    expect(urls).toHaveLength(2);
  });
});
