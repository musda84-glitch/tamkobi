import {
  canSendOutgoingDispatch,
  despatchGibAccepted,
  isIncomingDispatch,
  tcknValid,
  validateDespatchForm,
  vknValid,
} from "./despatchShipment";

const base = {
  despatch_mode: "own",
  issue_date: "2026-10-15",
  issue_time: "10:30",
  shipping_address: "Teslim adresi",
  despatch_plate: "34 ABC 123",
  despatch_driver_first: "Ali",
  despatch_driver_last: "Yılmaz",
  despatch_driver_tckn: "10000000146",
};

test("kendi aracı geçerli, bozuk plaka ve TCKN reddedilir", () => {
  expect(validateDespatchForm(base)).toEqual([]);
  expect(tcknValid("10000000146")).toBe(true);
  expect(tcknValid("11111111111")).toBe(false);
  expect(validateDespatchForm({ ...base, despatch_plate: "ABC" }).join(" ")).toMatch(/plaka/i);
  expect(validateDespatchForm({ ...base, despatch_driver_tckn: "111" }).join(" ")).toMatch(/TCKN/);
  expect(validateDespatchForm({ ...base, despatch_driver_first: "" }).join(" ")).toMatch(/Şoför adı/);
});

test("taşıyıcı modunda VKN ve ünvan zorunlu, takip no değil", () => {
  expect(vknValid("4810173324")).toBe(true);
  expect(vknValid("0000000000")).toBe(false);
  const carrier = {
    despatch_mode: "carrier",
    issue_date: "2026-10-15",
    issue_time: "09:00",
    shipping_address: "Depo",
    despatch_carrier_vkn: "4810173324",
    despatch_carrier_name: "Hızlı Kargo",
  };
  expect(validateDespatchForm(carrier)).toEqual([]);
  expect(validateDespatchForm({ ...carrier, despatch_carrier_name: "" }).join(" ")).toMatch(/ünvan/);
  expect(validateDespatchForm({ ...carrier, despatch_carrier_vkn: "123" }).join(" ")).toMatch(/VKN/);
  expect(validateDespatchForm({ ...carrier, issue_date: "" }).join(" ")).toMatch(/Sevk tarihi/);
});

test("gelen irsaliye gönderilmez, hatalı giden düzeltilebilir, kabul edilmiş gönderilmez", () => {
  const incoming = { invoice_type: "dispatch", source: "edoc_inbox", invoice_number: "GELEN-1" };
  expect(isIncomingDispatch(incoming)).toBe(true);
  expect(canSendOutgoingDispatch(incoming)).toBe(false);
  const failed = {
    invoice_type: "dispatch",
    e_type: "e_dispatch",
    einvoice_state: "error",
    gib_status: "Hata: şema",
    gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  };
  expect(despatchGibAccepted(failed)).toBe(false);
  expect(canSendOutgoingDispatch(failed)).toBe(true);
  const accepted = {
    invoice_type: "dispatch",
    einvoice_state: "sent",
    gib_status_code: "1300",
    gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  };
  expect(despatchGibAccepted(accepted)).toBe(true);
  expect(canSendOutgoingDispatch(accepted)).toBe(false);
});
