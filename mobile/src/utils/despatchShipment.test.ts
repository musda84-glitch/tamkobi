import {
  canSendOutgoingDispatch,
  despatchFormFrom,
  despatchGibAccepted,
  despatchSendLabel,
  despatchSendPayload,
  dispatchDirFromParam,
  isIncomingDispatch,
  splitDispatchLists,
  tcknValid,
  validateDespatchForm,
  vknValid,
} from "./despatchShipment";

const base = {
  despatch_mode: "own" as const,
  issue_date: "2026-10-15",
  issue_time: "10:30",
  shipping_address: "Teslim adresi",
  despatch_plate: "34 ABC 123",
  despatch_driver_first: "Ali",
  despatch_driver_last: "Yılmaz",
  despatch_driver_tckn: "10000000146",
  despatch_carrier_vkn: "",
  despatch_carrier_name: "",
  cargo_tracking_number: "",
};

test("kendi aracı geçerli, bozuk plaka ve TCKN reddedilir", () => {
  expect(validateDespatchForm(base)).toEqual([]);
  expect(tcknValid("10000000146")).toBe(true);
  expect(tcknValid("11111111111")).toBe(false);
  expect(validateDespatchForm({ ...base, despatch_plate: "ABC" }).join(" ")).toMatch(/plaka/i);
  expect(validateDespatchForm({ ...base, despatch_driver_tckn: "111" }).join(" ")).toMatch(/TCKN/);
  expect(validateDespatchForm({ ...base, despatch_driver_first: "" }).join(" ")).toMatch(/Şoför adı/);
  expect(despatchSendPayload(base).despatch_plate).toBe("34ABC123");
  expect(despatchSendPayload(base).issue_time).toBe("10:30:00");
});

test("taşıyıcı modunda VKN ve ünvan zorunlu", () => {
  expect(vknValid("4810173324")).toBe(true);
  expect(vknValid("0000000000")).toBe(false);
  const carrier = {
    ...base,
    despatch_mode: "carrier" as const,
    despatch_carrier_vkn: "4810173324",
    despatch_carrier_name: "Hızlı Kargo",
  };
  expect(validateDespatchForm(carrier)).toEqual([]);
  expect(validateDespatchForm({ ...carrier, despatch_carrier_name: "" }).join(" ")).toMatch(/ünvan/);
  expect(validateDespatchForm({ ...carrier, despatch_carrier_vkn: "123" }).join(" ")).toMatch(/VKN/);
});

test("gelen ve giden ayrılır; gelen gönderilmez, hatalı düzeltilir, kabul edilmiş gönderilmez", () => {
  const incoming = { invoice_type: "dispatch", source: "edoc_inbox", invoice_number: "GELEN-1" };
  const outgoing = { invoice_type: "dispatch", invoice_number: "IRS-2026-0007", einvoice_state: "error", gib_status: "Hata: şema" };
  const accepted = {
    invoice_type: "dispatch",
    invoice_number: "IRS-OK",
    einvoice_state: "sent",
    gib_status_code: "1300",
    gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  };
  const split = splitDispatchLists([incoming, outgoing, accepted]);
  expect(split.incoming.map((r) => r.invoice_number)).toEqual(["GELEN-1"]);
  expect(split.outgoing).toHaveLength(2);
  expect(isIncomingDispatch(incoming)).toBe(true);
  expect(canSendOutgoingDispatch(incoming)).toBe(false);
  expect(despatchGibAccepted(outgoing)).toBe(false);
  expect(canSendOutgoingDispatch(outgoing)).toBe(true);
  expect(despatchSendLabel(outgoing)).toBe("Düzelt ve tekrar gönder");
  expect(despatchGibAccepted(accepted)).toBe(true);
  expect(canSendOutgoingDispatch(accepted)).toBe(false);
  expect(dispatchDirFromParam("in")).toBe("in");
  expect(dispatchDirFromParam("out")).toBe("out");
  expect(dispatchDirFromParam(undefined)).toBe("out");
});

test("form varsayılanları ve cari adresi dolar", () => {
  const form = despatchFormFrom(
    { invoice_type: "dispatch", issue_date: "2026-10-15" },
    { plate: "06XYZ789", driver_first: "Ali", driver_last: "Yılmaz", driver_tckn: "10000000146" },
    "Cari adresi",
  );
  expect(form.despatch_mode).toBe("own");
  expect(form.despatch_plate).toBe("06XYZ789");
  expect(form.shipping_address).toBe("Cari adresi");
  expect(validateDespatchForm(form)).toEqual([]);
});
