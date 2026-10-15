import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ElektronikFaturaOnayModal } from "./ElektronikFaturaOnayModal";
import { clearGibMukellefCache } from "../utils/gibMukellef";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() } }));

let host;

beforeEach(() => {
  clearGibMukellefCache();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
  clearGibMukellefCache();
});

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mockLookup(lookup) {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/gib/lookup")) return Promise.resolve({ data: lookup });
    return Promise.resolve({ data: { balance: 4, source: "wallet" } });
  });
}

test("mükellef değil → yalnızca e-Arşiv butonu ve eType e_archive", async () => {
  mockLookup({
    tax_id: "12345678901",
    is_e_invoice_user: false,
    suggested_e_type: "e_archive",
    message: "GİB e-Fatura listesinde kayıtlı değil",
  });
  const onConfirm = jest.fn(async () => ({}));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{
          id: "inv1",
          invoice_number: "F1",
          contact_tax_id: "12345678901",
          contact_id: "c-flag",
          is_e_invoice_user: true,
        }}
        contacts={[{ id: "c-flag", is_e_invoice_user: true, tax_number_or_id: "12345678901" }]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  await flush();

  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')?.textContent).toMatch(/e-Arşiv Fatura Gönder/);
  expect(host.querySelector('[data-testid="efatura-onay-temel"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-ticari"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-scenario-menu"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="efatura-onay-earsiv"]').click();
  });
  await flush();

  expect(onConfirm).toHaveBeenCalled();
  const payload = onConfirm.mock.calls[0][0];
  expect(payload.eType).toBe("e_archive");
  expect(payload.gibMeta.is_e_invoice_user).toBe(false);
  expect(payload.documents[0].eType).toBe("e_archive");
});

test("GİB 502 iken gönderim kapalı ve tekrar sorgula görünür", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/gib/lookup")) {
      const err = new Error("İşNet SOAP GİB sorgusu başarısız.");
      err.response = { status: 502, data: { detail: "İşNet SOAP GİB sorgusu başarısız." } };
      return Promise.reject(err);
    }
    return Promise.resolve({ data: { balance: 1, source: "isnet" } });
  });
  const onConfirm = jest.fn(async () => ({}));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{ id: "inv2", invoice_number: "F2", contact_tax_id: "6320984412" }}
        contacts={[{ id: "c2", is_e_invoice_user: true, tax_number_or_id: "6320984412" }]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  await flush();

  expect(host.querySelector('[data-testid="efatura-onay-retry"]')?.textContent).toMatch(/Tekrar sorgula/);
  expect(host.querySelector('[data-testid="efatura-onay-blocked"]')?.disabled).toBe(true);
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-temel"]')).toBeNull();
  expect(host.textContent).toMatch(/GİB sorgusu başarısız/);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("yer tutucu TCKN canlı sorgu olmadan e-Arşiv gönderir", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/gib/lookup")) {
      return Promise.reject(new Error("lookup çağrılmamalı"));
    }
    return Promise.resolve({ data: { balance: 2, source: "wallet" } });
  });
  const onConfirm = jest.fn(async () => ({}));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{ id: "inv3", invoice_number: "F3", contact_tax_id: "11111111111" }}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  await flush();
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/gib/lookup"))).toBe(false);
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-temel"]')).toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="efatura-onay-earsiv"]').click();
  });
  await flush();
  expect(onConfirm.mock.calls[0][0].eType).toBe("e_archive");
});

test("fatura VKN cariden önce sorgulanır; unvan, kaynak ve etiket görünür", async () => {
  const calls = [];
  axios.get.mockImplementation((url, cfg) => {
    if (String(url).includes("/gib/lookup")) {
      calls.push(cfg?.params || {});
      return Promise.resolve({
        data: {
          tax_id: "3680486408",
          is_e_invoice_user: true,
          suggested_e_type: "e_invoice",
          lookup_status: "mukellef",
          name: "ERSAY HOME",
          source: "isnet",
          alias: "urn:mail:pk@ersay.home",
          aliases: ["urn:mail:pk@ersay.home", "urn:mail:gb@ersay.home"],
        },
      });
    }
    return Promise.resolve({ data: { balance: 9, source: "isnet" } });
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{
          id: "inv-ersay",
          invoice_number: "TA2026000000055",
          contact_tax_id: "3680486408",
          contact_name: "ERSAY HOME",
          contact_id: "cnt-ersay",
        }}
        contacts={[{ id: "cnt-ersay", name: "Eski Cari", tax_number_or_id: "12345678901", is_e_invoice_user: false }]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={jest.fn(async () => ({}))}
      />,
    );
  });
  await flush();
  expect(calls[0]?.tax_id).toBe("3680486408");
  expect(host.querySelector('[data-testid="efatura-onay-vkn"]')?.textContent).toMatch(/3680486408/);
  expect(host.querySelector('[data-testid="efatura-onay-unvan"]')?.textContent).toMatch(/ERSAY HOME/);
  expect(host.querySelector('[data-testid="efatura-onay-source"]')?.textContent).toMatch(/isnet/);
  expect(host.querySelector('[data-testid="efatura-onay-aliases"]')?.textContent).toMatch(/urn:mail:pk@ersay.home/);
  expect(host.querySelector('[data-testid="efatura-onay-tax-mismatch"]')?.textContent).toMatch(/Fatura VKN 3680486408 ile cari VKN 12345678901 farklı/);
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-continue"]')).not.toBeNull();
  await act(async () => {
    host.querySelector('[data-testid="efatura-onay-continue"]').click();
  });
  expect(host.querySelector('[data-testid="efatura-onay-temel"]')).not.toBeNull();
});

test("unknown gönderimi kilitler; Tekrar sorgula ve yeniden sorgula refresh=1 gönderir", async () => {
  const calls = [];
  axios.get.mockImplementation((url, cfg) => {
    if (String(url).includes("/gib/lookup")) {
      calls.push(cfg?.params || {});
      const err = new Error("GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı.");
      err.response = { status: 422, data: { detail: err.message } };
      return Promise.reject(err);
    }
    return Promise.resolve({ data: { balance: 1, source: "isnet" } });
  });
  const onConfirm = jest.fn(async () => ({}));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{ id: "inv-unk", invoice_number: "F9", contact_tax_id: "3680486408" }}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
  });
  await flush();
  expect(host.querySelector('[data-testid="efatura-onay-retry"]')?.textContent).toMatch(/Tekrar sorgula/);
  expect(host.querySelector('[data-testid="efatura-onay-blocked"]')?.disabled).toBe(true);
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-vkn"]')?.textContent).toMatch(/3680486408/);
  expect(host.textContent).toMatch(/TaxPayer/);
  await act(async () => {
    host.querySelector('[data-testid="efatura-onay-retry"]').click();
  });
  await flush();
  expect(calls.some((p) => String(p.refresh) === "1" || p.refresh === 1)).toBe(true);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("toplu kesimde bir belgenin hatası diğerini e-Arşiv yapmaz", async () => {
  axios.get.mockImplementation((url, cfg) => {
    if (String(url).includes("/gib/lookup")) {
      const tax = cfg?.params?.tax_id;
      if (tax === "1112223334") {
        const err = new Error("GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı.");
        err.response = { status: 422, data: { detail: err.message } };
        return Promise.reject(err);
      }
      return Promise.resolve({
        data: {
          tax_id: tax,
          is_e_invoice_user: true,
          suggested_e_type: "e_invoice",
          lookup_status: "mukellef",
          name: "ERSAY HOME",
          source: "isnet",
          aliases: ["urn:mail:pk@ersay.home"],
        },
      });
    }
    return Promise.resolve({ data: { balance: 3, source: "isnet" } });
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoices={[
          { id: "bad", invoice_number: "BAD", contact_tax_id: "1112223334", contact_name: "Bilinmeyen" },
          { id: "good", invoice_number: "GOOD", contact_tax_id: "3680486408", contact_name: "ERSAY HOME" },
        ]}
        contacts={[]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={jest.fn(async () => ({}))}
      />,
    );
  });
  await flush();
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).toBeNull();
  expect(host.querySelector('[data-testid="efatura-onay-blocked"]')).not.toBeNull();
  const rows = [...host.querySelectorAll('[data-testid="efatura-onay-bulk-preview"] li')];
  expect(rows.map((el) => el.getAttribute("data-kind"))).toEqual(["Sorgu hatası", "E-Fatura"]);
});

test("eksik VKN sessizce e-Arşiv olmaz", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/gib/lookup")) return Promise.reject(new Error("lookup çağrılmamalı"));
    return Promise.resolve({ data: { balance: 1, source: "wallet" } });
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ElektronikFaturaOnayModal
        mode="send"
        invoice={{ id: "inv-blank", invoice_number: "B", contact_tax_id: "" }}
        contacts={[{ id: "c", tax_number_or_id: "12" }]}
        companyId="c1"
        onClose={() => {}}
        onConfirm={jest.fn()}
      />,
    );
  });
  await flush();
  expect(host.querySelector('[data-testid="efatura-onay-earsiv"]')).toBeNull();
  expect(host.textContent).toMatch(/VKN eksik/);
  expect(axios.get.mock.calls.some((c) => String(c[0]).includes("/gib/lookup"))).toBe(false);
});
