import {
  GIB_MUKELLEF_TTL_MS,
  buyerTaxChoice,
  clearGibMukellefCache,
  docBuyerTaxId,
  eTypeFromGib,
  fetchGibMukellef,
  peekGibMukellef,
} from "./gibMukellef";

beforeEach(() => {
  clearGibMukellefCache();
});

afterEach(() => {
  clearGibMukellefCache();
  jest.restoreAllMocks();
});

test("docBuyerTaxId fatura VKN'sini cariden önce alır", () => {
  const doc = { contact_tax_id: "3680486408", buyer_tax_id: "11111111111" };
  const contact = { tax_number_or_id: "12345678901" };
  expect(docBuyerTaxId(doc, contact)).toBe("3680486408");
  expect(buyerTaxChoice(doc, contact).mismatch).toBe(true);
  expect(docBuyerTaxId({ contact_tax_id: "" }, contact)).toBe("12345678901");
});

test("eTypeFromGib mesaj metnine bakmaz; unknown e-Arşiv değildir", () => {
  expect(eTypeFromGib({
    is_e_invoice_user: true,
    suggested_e_type: "e_invoice",
    message: "Kayıt bulunamadı",
  })).toBe("e_invoice");
  expect(eTypeFromGib({
    lookup_status: "unknown",
    is_e_invoice_user: false,
    suggested_e_type: "e_archive",
    message: "bulunamadı",
  })).toBeNull();
  expect(eTypeFromGib({
    is_e_invoice_user: true,
    suggested_e_type: "e_archive",
  })).toBeNull();
  expect(eTypeFromGib({ lookup_status: "not_mukellef" })).toBe("e_archive");
  expect(eTypeFromGib({ lookup_status: "mukellef" })).toBe("e_invoice");
});

test("başarılı sorgu 120 sn sonra yeniden gider; hata ve unknown önbelleğe yazılmaz", async () => {
  const now = 1_700_000_000_000;
  const spy = jest.spyOn(Date, "now").mockReturnValue(now);
  const axiosGet = jest.fn(async (_url, cfg) => ({
    data: {
      tax_id: cfg.params.tax_id,
      is_e_invoice_user: true,
      suggested_e_type: "e_invoice",
      lookup_status: "mukellef",
      name: "ERSAY HOME",
      source: "isnet",
      alias: "urn:mail:pk@ersay.home",
      aliases: ["urn:mail:pk@ersay.home"],
    },
  }));
  const first = await fetchGibMukellef("c1", "3680486408", axiosGet);
  expect(first.status).toBe("ok");
  expect(first.expiresAt).toBe(now + GIB_MUKELLEF_TTL_MS);
  await fetchGibMukellef("c1", "3680486408", axiosGet);
  expect(axiosGet).toHaveBeenCalledTimes(1);

  spy.mockReturnValue(now + GIB_MUKELLEF_TTL_MS);
  expect(peekGibMukellef("c1", "3680486408")).toBeNull();
  await fetchGibMukellef("c1", "3680486408", axiosGet);
  expect(axiosGet).toHaveBeenCalledTimes(2);

  axiosGet.mockImplementation(async () => {
    const err = new Error("GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı.");
    err.response = { status: 422, data: { detail: err.message } };
    throw err;
  });
  await expect(fetchGibMukellef("c1", "1112223334", axiosGet)).rejects.toThrow(/TaxPayer/);
  await expect(fetchGibMukellef("c1", "1112223334", axiosGet)).rejects.toThrow(/TaxPayer/);
  expect(axiosGet).toHaveBeenCalledTimes(4);
  expect(peekGibMukellef("c1", "1112223334")).toBeNull();

  axiosGet.mockResolvedValue({
    data: {
      lookup_status: "unknown",
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
      message: "GİB kaydı bulunamadı; mükellefiyet doğrulanamadı.",
    },
  });
  await expect(fetchGibMukellef("c1", "6320984412", axiosGet)).rejects.toThrow(/doğrulanamadı/);
  expect(peekGibMukellef("c1", "6320984412")).toBeNull();
  expect(eTypeFromGib({ lookup_status: "unknown", message: "bulunamadı" })).toBeNull();
});

test("eksik VKN önbelleğe yazılmaz ve e-Arşiv sayılmaz; yer tutucu sorgu atmaz", async () => {
  const axiosGet = jest.fn();
  await expect(fetchGibMukellef("c1", "123", axiosGet)).rejects.toThrow("VKN eksik");
  await expect(fetchGibMukellef("c1", "", axiosGet)).rejects.toThrow("VKN eksik");
  expect(peekGibMukellef("c1", "123")).toBeNull();
  const placeholder = await fetchGibMukellef("c1", "11111111111", axiosGet);
  expect(placeholder.data.lookup_status).toBe("not_mukellef");
  expect(placeholder.data.suggested_e_type).toBe("e_archive");
  expect(axiosGet).not.toHaveBeenCalled();
});
