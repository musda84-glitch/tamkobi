/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { OrdersList, orderItemsPreview } from "./B2BPortalParts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const longStep = "Duvar Rafı Çizgili DRC 70x20cm - Çam";

function steps(count) {
  return Array.from({ length: count }, (_, i) => {
    const no = i + 1;
    return {
      no,
      name: no === 1 ? longStep : `Adım ${no}`,
      station: no === 1 ? "CNC OEMAK" : "",
      done: false,
      current: no === 1,
    };
  });
}

const ORDER_97 = {
  id: "97",
  order_number: "B2B-2026-0097",
  order_status: "pending",
  order_date: "2026-10-20",
  grand_total: 120,
  items: [{ product_id: "ad", product_name: "Ad", quantity: 14 }],
};

const ORDER_96 = {
  id: "96",
  order_number: "B2B-2026-0096",
  order_status: "approved",
  order_date: "2026-10-19",
  customer_order_number: "PO-44",
  grand_total: 250,
  items: [{ product_id: "raf", product_name: "Raf", quantity: 1 }],
  production: {
    status: "completed",
    status_label: "Üretim tamamlandı",
    active: true,
    done: 2,
    total: 3,
    current_step_name: "Montaj",
    steps: [
      { no: 1, name: "Kesim", station: "CNC OEMAK", done: true, current: false },
      { no: 2, name: "Montaj", station: "", done: false, current: true },
      { no: 3, name: "Paket", station: "", done: false, current: false },
    ],
  },
};

const ORDER_94 = {
  id: "94",
  order_number: "B2B-2026-0094",
  order_status: "approved",
  order_date: "2026-10-18",
  grand_total: 90,
  items: [{ product_id: "raf", product_name: "Raf", quantity: 3 }],
  production: {
    status: "completed",
    status_label: "Üretimde",
    active: true,
    done: 3,
    total: 3,
    steps: [
      { no: 1, name: "Kesim", done: true, current: false },
      { no: 2, name: "Montaj", done: true, current: false },
      { no: 3, name: "Paket", done: true, current: false },
    ],
  },
};

const ORDER_95 = {
  id: "95",
  order_number: "B2B-2026-0095",
  order_status: "approved",
  order_date: "2026-10-17",
  grand_total: 1400,
  items: Array.from({ length: 14 }, (_, i) => ({
    product_id: `p${i + 1}`,
    product_name: `Kalem ${i + 1}`,
    quantity: i + 1,
  })),
  production: {
    status: "planned",
    status_label: "Üretim tamamlandı",
    active: true,
    done: 0,
    total: 14,
    current_step_name: longStep,
    steps: steps(14),
  },
};

const HELD = {
  id: "hold1",
  order_number: "Bekleyen sepet #1",
  order_status: "held_cart",
  is_held_cart: true,
  held_seq: 1,
  view_only: true,
  order_date: "2026-10-16",
  grand_total: 10,
  items: [{ product_id: "taslak", product_name: "Taslak", quantity: 1 }],
};

let host;
let root;

function renderList() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <OrdersList
        orders={[ORDER_97, ORDER_96, ORDER_94, ORDER_95]}
        heldRows={[HELD]}
        token="tok"
        products={[]}
        company={{}}
        onChanged={() => {}}
      />,
    );
  });
}

function q(rootEl, testId) {
  return rootEl.querySelector(`[data-testid="${testId}"]`);
}

function buttons(rootEl, name) {
  return [...rootEl.querySelectorAll("button")].filter((el) => (el.getAttribute("aria-label") || el.textContent || "").trim() === name);
}

function button(rootEl, name) {
  const found = buttons(rootEl, name);
  if (!found.length) throw new Error(`button not found: ${name}`);
  return found[0];
}

function testIds(rootEl, pattern) {
  return [...rootEl.querySelectorAll("[data-testid]")].filter((el) => pattern.test(el.getAttribute("data-testid") || ""));
}

describe("orderItemsPreview", () => {
  it("returns an empty preview for empty items", () => {
    expect(orderItemsPreview([], 2)).toEqual({ shown: [], rest: 0 });
    expect(orderItemsPreview(null, 2)).toEqual({ shown: [], rest: 0 });
    expect(orderItemsPreview(undefined)).toEqual({ shown: [], rest: 0 });
  });

  it("keeps the first items and counts the rest", () => {
    const items = ["a", "b", "c"];
    expect(orderItemsPreview(items, 2)).toEqual({ shown: ["a", "b"], rest: 1 });
  });
});

describe("OrdersList", () => {
  afterEach(() => {
    if (root) {
      act(() => { root.unmount(); });
      root = null;
    }
    if (host) {
      host.remove();
      host = null;
    }
    axios.get.mockReset();
    axios.post.mockReset();
    axios.put.mockReset();
    axios.delete.mockReset();
  });

  it("uses one line for the order number and date, and drops the Sizin no column", () => {
    renderList();
    const headers = [...host.querySelectorAll("thead th")].map((el) => el.textContent);
    expect(headers).toEqual(["Sipariş No", "Tarih", "Ürünler", "Tutar", "Durum", "Üretim / Kargo", "İşlem"]);
    expect(headers.join(" ")).not.toContain("Sizin no");

    const pending = q(host, "b2b-order-row-B2B-2026-0097");
    const number = [...pending.querySelectorAll("div")].find((el) => el.textContent === "B2B-2026-0097");
    expect(number.className).toContain("truncate");
    expect(number.getAttribute("title")).toBe("B2B-2026-0097");
    expect(number.className).toContain("font-mono");
    expect(pending.textContent).toContain("20.10.2026");
    expect(pending.textContent).not.toContain("Sizin no:");
    expect(pending.textContent).toContain("Beklemede");
    expect(q(pending, "b2b-prod-status-B2B-2026-0097")).toBeNull();

    const label = pending.querySelector('[title="14× Ad"]');
    expect(label.querySelector("b").textContent).toBe("14×");

    const edit = button(pending, "Düzenle");
    const remove = button(pending, "Sil");
    expect(edit.getAttribute("aria-label")).toBe("Düzenle");
    expect(edit.getAttribute("title")).toBe("Düzenle");
    expect(edit.className).toContain("w-7");
    expect(edit.className).toContain("h-7");
    expect(edit.className).toContain("bg-slate-900");
    expect(remove.getAttribute("aria-label")).toBe("Sil");
    expect(remove.className).toContain("border-rose-200");
    expect(button(pending, "Önizle").className).toContain("w-7");
    expect(buttons(pending, "İptal talebi")).toHaveLength(0);

    const card = q(host, "b2b-order-B2B-2026-0097");
    const cardNumber = card.querySelector(".font-mono");
    expect(cardNumber.className).toContain("truncate");
    expect(cardNumber.getAttribute("title")).toBe("B2B-2026-0097");
    expect(card.textContent).toContain("20.10.2026");
    expect(button(card, "Sil")).toBeTruthy();
  });

  it("renders preview, edit, and delete icons in the actions column", () => {
    renderList();
    const table = host.querySelector("table");
    expect(table.className).toContain("lg:table");
    expect(table.className).not.toContain("md:table");
    const cards = host.querySelector("[data-testid='b2b-orders'] > div.divide-y");
    expect(cards.className).toContain("lg:hidden");
    expect(cards.className).not.toContain("md:hidden");

    const cols = [...table.querySelectorAll("col")];
    expect(cols[0].className).toContain("w-32");
    expect(cols[0].className).toContain("min-w-32");
    expect(cols[6].className).toContain("min-w-28");
    expect(cols[6].className).toContain("w-[7.5rem]");

    const actions = q(q(table, "b2b-order-row-B2B-2026-0097"), "b2b-order-actions-B2B-2026-0097");
    const icons = [...actions.querySelectorAll("button")];
    expect(icons.map((el) => el.getAttribute("aria-label"))).toEqual(["Önizle", "Düzenle", "Sil"]);
    icons.forEach((el) => {
      expect(el.querySelector("svg")).toBeTruthy();
      expect(el.className).toContain("w-7");
      expect(el.className).toContain("h-7");
    });

    const cells = [...q(table, "b2b-order-row-B2B-2026-0097").querySelectorAll("td")];
    expect(cells[1].querySelector(".truncate").textContent).toBe("20.10.2026");
    expect(cells[1].className).toContain("overflow-hidden");
    expect(cells[3].className).toContain("overflow-hidden");
    expect(cells[3].querySelector(".truncate")).toBeTruthy();
  });

  it("derives the badge from progress so a partial completion is not finished", () => {
    renderList();
    const partial = q(host, "b2b-order-row-B2B-2026-0096");
    const badge = q(partial, "b2b-prod-status-B2B-2026-0096");
    expect(badge.textContent).toBe("Üretimde");
    expect(badge.className).toContain("bg-sky-50");
    expect(q(partial, "b2b-production-progress-B2B-2026-0096").textContent).toBe("Üretim 2/3");
    expect(partial.textContent).not.toContain("Üretim tamamlandı");
    expect(partial.textContent).toContain("Sizin no:");
    expect(partial.textContent).toContain("PO-44");
    const bar = partial.querySelector('[role="progressbar"]');
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(q(partial, "b2b-production-steps-B2B-2026-0096")).toBeNull();

    const done = q(host, "b2b-order-row-B2B-2026-0094");
    const doneBadge = q(done, "b2b-prod-status-B2B-2026-0094");
    expect(doneBadge.textContent).toBe("Üretim tamamlandı");
    expect(doneBadge.className).toContain("bg-emerald-50");
    expect(q(done, "b2b-production-progress-B2B-2026-0094").textContent).toBe("Üretim 3/3");
    expect(done.querySelector('[role="progressbar"]').firstChild.className).toContain("bg-emerald-500");
    expect(button(done, "İptal talebi").className).toContain("border-rose-200");
  });

  it("previews two products and five steps until the toggles open", () => {
    renderList();
    const row = q(host, "b2b-order-row-B2B-2026-0095");
    expect(q(row, "b2b-prod-status-B2B-2026-0095").textContent).toBe("Üretim planlandı");
    expect(row.textContent).toContain(`Üretim 0/14 · Şu an: ${longStep}`);
    const bar = row.querySelector('[role="progressbar"]');
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("14");
    expect(bar.firstChild.className).toContain("bg-amber-400");
    expect(row.querySelectorAll("b")).toHaveLength(2);
    expect(row.textContent).not.toContain("Kalem 3");

    const more = button(row, "+12 ürün daha ▾");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => { more.click(); });
    expect(button(row, "Daha az ▴").getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("Kalem 14");
    expect(row.querySelectorAll("b")).toHaveLength(14);
    act(() => { button(row, "Daha az ▴").click(); });
    expect(row.querySelectorAll("b")).toHaveLength(2);

    expect(q(row, "b2b-production-steps-B2B-2026-0095")).toBeNull();
    const detail = button(row, "Detay ▾");
    expect(detail.getAttribute("aria-expanded")).toBe("false");
    act(() => { detail.click(); });
    expect(button(row, "Detay ▴").getAttribute("aria-expanded")).toBe("true");
    const listed = testIds(row, /^b2b-production-step-B2B-2026-0095-/);
    expect(listed).toHaveLength(5);
    expect(listed[0].getAttribute("data-testid")).toBe("b2b-production-step-B2B-2026-0095-1");
    expect(listed[0].querySelector(".font-mono").textContent).toBe("1.");
    expect(listed[0].querySelector(".font-mono").className).toContain("text-slate-400");
    expect(listed[0].querySelector("[title]").getAttribute("title")).toBe(longStep);
    expect(listed[0].textContent).toContain("▶");
    expect(listed[0].className).toContain("font-bold");
    expect(listed[0].className).toContain("text-amber-800");
    const station = [...listed[0].querySelectorAll("span")].find((el) => el.textContent === "CNC OEMAK");
    expect(station.className).toContain("whitespace-nowrap");
    act(() => { button(row, "+9 adım daha").click(); });
    expect(testIds(row, /^b2b-production-step-B2B-2026-0095-/)).toHaveLength(14);
    act(() => { button(row, "Detay ▴").click(); });
    expect(q(row, "b2b-production-steps-B2B-2026-0095")).toBeNull();
    expect(button(row, "Detay ▾").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a held cart faded, without production or edit actions", () => {
    renderList();
    const table = host.querySelector("table");
    const held = q(table, "b2b-held-row-hold1");
    expect(held.className).toContain("opacity-60");
    expect(q(held, "b2b-held-badge-hold1").textContent).toBe("Bekleyen sepet #1");
    expect(testIds(held, /^b2b-production/)).toHaveLength(0);
    expect(held.textContent).toContain("—");
    expect(buttons(held, "Düzenle")).toHaveLength(0);
    expect(buttons(held, "Sil")).toHaveLength(0);
    expect(buttons(held, "İptal talebi")).toHaveLength(0);
    expect(button(held, "Önizle")).toBeTruthy();
  });
});
