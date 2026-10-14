import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ContactSearchSelect, CONTACT_SEARCH_DEBOUNCE_MS } from "./ContactSearchSelect";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), defaults: {}, isCancel: () => false };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 20, has_more: false, suggestions: [] } });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.innerHTML = "";
  jest.useRealTimers();
});

function render(node) {
  root = createRoot(host);
  return act(async () => {
    root.render(node || <ContactSearchSelect companyId="c1" value="" onChange={() => {}} testId="cs" />);
  });
}

test("debounce is 300 ms and query is sent after the wait", async () => {
  jest.useFakeTimers();
  await render();
  await act(async () => {
    host.querySelector('[data-testid="cs-trigger"]').click();
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][1].params.q).toBe("");

  const input = document.querySelector('[data-testid="cs-search"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "ersay");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    jest.advanceTimersByTime(CONTACT_SEARCH_DEBOUNCE_MS - 1);
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.get.mock.calls[1][1].params).toMatchObject({ company_id: "c1", q: "ersay", page: 1, limit: 20 });
});

test("keyboard selects the firma adı suggestion and empty option stays first", async () => {
  const onChange = jest.fn();
  axios.get.mockResolvedValue({
    data: {
      items: [
        { id: "c1", name: "Diğer Firma", type: "customer", phone: "0532" },
        { id: "c2", name: "Uzak", type: "supplier" },
      ],
      suggestions: [{ id: "c9", name: "MOR PLASTIK ISTANBUL", type: "supplier", company_title: "Mor Plastik", tax_number_or_id: "111" }],
      suggest_query: "MOR PLASTIK ISTANBUL",
      total: 2,
      page: 1,
      limit: 20,
      has_more: true,
    },
  });
  await render(
    <ContactSearchSelect
      companyId="c1"
      value=""
      onChange={onChange}
      testId="cs"
      emptyLabel="Cari seçin (boş = sadece onayla)"
      suggestText="Firma Adı: MOR PLASTIK ISTANBUL"
      counterparty="MOR PLASTIK"
    />,
  );
  await act(async () => {
    host.querySelector('[data-testid="cs-trigger"]').click();
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(axios.get).toHaveBeenCalled();
  expect(axios.get.mock.calls.at(-1)[1].params).toMatchObject({
    company_id: "c1",
    q: "",
    suggest: "Firma Adı: MOR PLASTIK ISTANBUL",
    counterparty: "MOR PLASTIK",
    page: 1,
    limit: 20,
  });
  const menu = document.querySelector('[data-testid="cs-menu"]');
  const order = [...menu.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid"));
  expect(order.indexOf("cs-empty")).toBeLessThan(order.indexOf("cs-suggest-c9"));
  expect(order.indexOf("cs-suggest-c9")).toBeLessThan(order.indexOf("cs-option-c1"));
  expect(menu.textContent).toContain("MOR PLASTIK ISTANBUL");
  expect(document.querySelector('[data-testid="cs-suggest-c9"]').getAttribute("data-active")).toBe("1");

  const input = document.querySelector('[data-testid="cs-search"]');
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("c9", expect.objectContaining({ name: "MOR PLASTIK ISTANBUL" }));

  onChange.mockClear();
  await act(async () => {
    host.querySelector('[data-testid="cs-trigger"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  const input2 = document.querySelector('[data-testid="cs-search"]');
  await act(async () => {
    input2.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("", null);
});

test("each row shows Turkish balance beside the name", async () => {
  axios.get.mockResolvedValue({
    data: {
      items: [
        { id: "c1", name: "Borçlu Cari", balance_display: -12450, balance_currency: "TRY" },
        { id: "c2", name: "Alacaklı Cari", balance_display: 3200, balance_currency: "TRY" },
        { id: "c3", name: "Denk Cari", balance_display: 0, balance_currency: "TRY" },
        { id: "c4", name: "Döviz Cari", balance_display: 100, balance_currency: "USD" },
      ],
      suggestions: [],
      total: 4,
      page: 1,
      limit: 20,
      has_more: false,
    },
  });
  await render(<ContactSearchSelect companyId="c1" value="" onChange={() => {}} testId="cs" />);
  await act(async () => {
    host.querySelector('[data-testid="cs-trigger"]').click();
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  const debt = document.querySelector('[data-testid="cs-balance-c1"]');
  const credit = document.querySelector('[data-testid="cs-balance-c2"]');
  const zero = document.querySelector('[data-testid="cs-balance-c3"]');
  const fx = document.querySelector('[data-testid="cs-balance-c4"]');
  expect(debt.textContent).toBe("12.450,00 ₺ B");
  expect(debt.getAttribute("data-side")).toBe("borc");
  expect(debt.className).toContain("text-rose-600");
  expect(credit.textContent).toBe("3.200,00 ₺ A");
  expect(credit.getAttribute("data-side")).toBe("alacak");
  expect(credit.className).toContain("text-emerald-600");
  expect(zero.textContent).toBe("0,00 ₺");
  expect(zero.getAttribute("data-side")).toBe("zero");
  expect(zero.className).toContain("text-slate-400");
  expect(fx.textContent).toBe("100,00 USD A");
  expect(document.querySelector('[data-testid="cs-option-c1"]').textContent).toContain("Borçlu Cari");
});
