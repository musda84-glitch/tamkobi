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
