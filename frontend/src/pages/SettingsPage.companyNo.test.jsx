import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CompanyForm } from "./SettingsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const COMPANY = {
  id: "comp_ada",
  name: "Ada Ltd",
  company_no: 100001,
  tax_number: "1111111111",
  price_decimals: 2,
};

let host;
let writeText;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  axios.get.mockResolvedValue({ data: COMPANY });
  axios.put.mockResolvedValue({ data: { ...COMPANY, name: "Ada Ltd" } });
});

afterEach(() => {
  host.remove();
  jest.clearAllMocks();
});

async function renderForm() {
  const root = createRoot(host);
  await act(async () => {
    root.render(<CompanyForm companyId="comp_ada" />);
  });
  await act(async () => { await Promise.resolve(); });
  return root;
}

test("Firma Ayarları Şirket ID salt okunur ve kopyalanır", async () => {
  await renderForm();
  expect(host.textContent).toContain("Şirket ID");
  const input = host.querySelector('[data-testid="company-no-input"]');
  expect(input).not.toBeNull();
  expect(input.readOnly).toBe(true);
  expect(input.value).toBe("100001");
  expect(host.querySelector('[data-testid="company-company_no-input"]')).toBeNull();

  await act(async () => {
    host.querySelector('[data-testid="company-no-copy"]').click();
  });
  expect(writeText).toHaveBeenCalledWith("100001");
  expect(toast.success).toHaveBeenCalledWith("Şirket ID kopyalandı.");

  const name = host.querySelector('[data-testid="company-name-input"]');
  await act(async () => {
    name.value = "Ada Ltd";
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('[data-testid="save-company-btn"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const save = axios.put.mock.calls.find((call) => String(call[0]).includes("/companies/comp_ada"));
  expect(save).toBeTruthy();
  expect(save[1].company_no).toBeUndefined();
  expect(save[1].name).toBe("Ada Ltd");
  expect(host.querySelector('[data-testid="company-no-input"]').value).toBe("100001");
  expect(host.querySelector('[data-testid="company-no-input"]').readOnly).toBe(true);
});

test("numara yoksa Şirket ID kopyalanamaz", async () => {
  axios.get.mockResolvedValue({ data: { id: "comp_ada", name: "Ada Ltd", price_decimals: 2 } });
  await renderForm();
  const input = host.querySelector('[data-testid="company-no-input"]');
  expect(input.readOnly).toBe(true);
  expect(input.value).toBe("—");
  const copy = host.querySelector('[data-testid="company-no-copy"]');
  expect(copy.disabled).toBe(true);
  await act(async () => { copy.click(); });
  expect(writeText).not.toHaveBeenCalled();
});
