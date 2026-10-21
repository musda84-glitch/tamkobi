/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { B2BHeader, fmt } from "./B2BPortalParts";
import { logoutB2B } from "../utils/b2bSession";

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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../utils/b2bSession", () => {
  const actual = jest.requireActual("../utils/b2bSession");
  return { ...actual, logoutB2B: jest.fn() };
});

const COMPANY = {
  name: "MATEK DEKORASYON MOBİLYA",
  logo_url: "",
  phone: "0216 555 12 34",
  email: "siparis@matekdekor.com.tr",
};
const CONTACT = {
  name: "Kardeşler Nalburiye İnşaat ve Yapı Tic. Ltd. Şti.",
  balance: 23942.35,
  discount: 5,
  has_password: true,
};
const SUPPLIERS = [
  {
    contact_id: "md",
    company_name: "MATEK DEKORASYON MOBİLYA",
    logo_url: "",
    contact_name: CONTACT.name,
    phone: "0216 555 12 34",
    email: "siparis@matekdekor.com.tr",
  },
  {
    contact_id: "ay",
    company_name: "AYDIN YAPI MALZEMELERİ A.Ş.",
    logo_url: "",
    contact_name: "Aydın Yapı",
    phone: "0232 444 56 78",
    email: "b2b@aydinyapi.com",
  },
  {
    contact_id: "kh",
    company_name: "KARA HIRDAVAT TİC. LTD.",
    logo_url: "",
    contact_name: "Kara Hırdavat",
    phone: "0312 333 90 11",
    email: "",
  },
];

let host;
let root;
let onPick;
let onSelectTab;

function setMedia(matches) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: !!matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
}

async function mount(props = {}) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <B2BHeader
        token="tok"
        company={COMPANY}
        contact={CONTACT}
        suppliers={SUPPLIERS}
        allowOrders
        showStatement
        cartCount={7}
        onPick={onPick}
        onSelectTab={onSelectTab}
        {...props}
      />,
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  onPick = jest.fn();
  onSelectTab = jest.fn();
  logoutB2B.mockClear();
  setMedia(false);
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
});

test("tek tedarikçide chevron ve menü yok, telefon kapalıyken görünmez", async () => {
  await mount({ suppliers: [SUPPLIERS[0]] });
  expect(host.querySelector("[data-testid='b2b-supplier-chevron']")).toBeNull();
  expect(host.querySelector("[data-testid='b2b-switch-supplier']")).toBeNull();
  expect(host.querySelector("[data-testid='b2b-switch-menu']")).toBeNull();
  expect(host.textContent).not.toContain("0216 555 12 34");
  expect(host.textContent).not.toContain("siparis@matekdekor.com.tr");
  expect(host.textContent).toContain("MATEK DEKORASYON MOBİLYA");
});

test("çoklu tedarikçide menü telefon ve e-postayı listeler, seçili işaretli, onPick id taşır", async () => {
  await mount();
  expect(host.querySelector("[data-testid='b2b-supplier-chevron']")).not.toBeNull();
  expect(host.textContent).not.toContain("0232 444 56 78");
  expect(host.textContent).not.toContain("b2b@aydinyapi.com");
  expect(host.textContent).not.toContain("0312 333 90 11");
  await act(async () => { host.querySelector("[data-testid='b2b-switch-supplier']").click(); });
  const menu = host.querySelector("[data-testid='b2b-switch-menu']");
  expect(menu.textContent).toContain("TEDARİKÇİ SEÇİN");
  expect(menu.textContent).toContain("AYDIN YAPI MALZEMELERİ A.Ş.");
  expect(menu.textContent).toContain("0232 444 56 78");
  expect(menu.textContent).toContain("b2b@aydinyapi.com");
  expect(menu.textContent).toContain("KARA HIRDAVAT TİC. LTD.");
  expect(menu.textContent).toContain("0312 333 90 11");
  expect(menu.textContent).toContain("0216 555 12 34");
  expect(menu.textContent).toContain("siparis@matekdekor.com.tr");
  const selected = host.querySelector("[data-testid='b2b-switch-item-md']");
  expect(selected.querySelector("[aria-label='Seçili']")).not.toBeNull();
  expect(selected.className).toMatch(/bg-emerald-50/);
  await act(async () => { host.querySelector("[data-testid='b2b-switch-item-ay']").click(); });
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ contact_id: "ay" }));
  expect(host.querySelector("[data-testid='b2b-switch-menu']")).toBeNull();
  expect(host.textContent).not.toContain("0232 444 56 78");
});

test("bakiye borç, alacak ve sıfır durumlarını ayırır", async () => {
  await mount();
  const card = host.querySelector("[data-testid='b2b-balance-card']");
  const amount = host.querySelector("[data-testid='b2b-balance']");
  expect(card.className).toMatch(/border-rose-200/);
  expect(card.className).toMatch(/bg-rose-50/);
  expect(card.className).toMatch(/border-2/);
  expect(card.className).toMatch(/rounded-xl/);
  expect(amount.className).toMatch(/text-rose-700/);
  expect(amount.className).toMatch(/font-extrabold/);
  expect(amount.textContent).toBe(fmt(23942.35));
  expect(host.querySelector("[data-testid='b2b-balance-pill']").textContent).toMatch(/borç/i);
  await act(async () => { host.querySelector("[data-testid='b2b-balance-statement']").click(); });
  expect(onSelectTab).toHaveBeenCalledWith("statement");

  act(() => root.unmount());
  root = null;
  await mount({ contact: { ...CONTACT, balance: -1500.5 } });
  const credit = host.querySelector("[data-testid='b2b-balance']");
  expect(host.querySelector("[data-testid='b2b-balance-card']").className).toMatch(/emerald/);
  expect(credit.className).toMatch(/text-emerald-700/);
  expect(credit.textContent).toBe(fmt(1500.5));
  expect(credit.textContent).not.toContain("-");
  expect(host.querySelector("[data-testid='b2b-balance-pill']").textContent).toMatch(/alacak/i);

  act(() => root.unmount());
  root = null;
  await mount({ contact: { ...CONTACT, balance: 0 }, showStatement: false });
  expect(host.querySelector("[data-testid='b2b-balance-pill']")).toBeNull();
  expect(host.querySelector("[data-testid='b2b-balance']").className).toMatch(/slate/);
  expect(host.querySelector("[data-testid='b2b-balance-card']").className).toMatch(/border-slate-200/);
  expect(host.textContent).not.toMatch(/borç/i);
  expect(host.textContent).not.toMatch(/alacak/i);
  expect(host.querySelector("[data-testid='b2b-balance-statement']")).toBeNull();
});

test("hesap menüsü kısa ad, tam ad, şifre, ekstre ve çıkış", async () => {
  await mount();
  expect(host.querySelector("[data-testid='b2b-account-avatar']").textContent).toBe("KN");
  expect(host.querySelector("[data-testid='b2b-contact-name']").textContent).toBe("Kardeşler Nalburiye");
  expect(host.querySelector("[data-testid='b2b-account-menu']")).toBeNull();
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
  const menu = host.querySelector("[data-testid='b2b-account-menu']");
  expect(menu.textContent).toContain(CONTACT.name);
  expect(menu.textContent).toContain("Bayi hesabı · %5 size özel indirim");
  expect(host.querySelector("[data-testid='b2b-balance-card']").textContent).not.toContain("indirim");
  await act(async () => { host.querySelector("[data-testid='b2b-account-statement']").click(); });
  expect(onSelectTab).toHaveBeenCalledWith("statement");
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
  await act(async () => { host.querySelector("[data-testid='b2b-change-password-btn']").click(); });
  expect(host.querySelector("[data-testid='b2b-change-password-modal']")).not.toBeNull();
  expect(host.querySelector("[data-testid='b2b-chg-current-password']")).not.toBeNull();
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
  await act(async () => { host.querySelector("[data-testid='b2b-header-logout']").click(); });
  expect(logoutB2B).toHaveBeenCalledTimes(1);
});

test("sepet rozeti adedi gösterir, sıfırda gizlenir, kapalıysa buton yoktur", async () => {
  await mount();
  const badge = host.querySelector("[data-testid='b2b-header-cart'] [data-testid='b2b-cart-badge']");
  expect(badge.textContent).toBe("7");
  expect(badge.getAttribute("aria-label")).toBe("Sepette 7 kalem");
  await act(async () => { host.querySelector("[data-testid='b2b-header-cart']").click(); });
  expect(onSelectTab).toHaveBeenCalledWith("cart");

  act(() => root.unmount());
  root = null;
  await mount({ cartCount: 0 });
  expect(host.querySelector("[data-testid='b2b-header-cart']")).not.toBeNull();
  expect(host.querySelector("[data-testid='b2b-cart-badge']")).toBeNull();

  act(() => root.unmount());
  root = null;
  await mount({ allowOrders: false, cartCount: 3 });
  expect(host.querySelector("[data-testid='b2b-header-cart']")).toBeNull();
  expect(host.querySelector("[data-testid='b2b-cart-badge']")).toBeNull();
});

test("TamKobi logosu mevcut marka dosyasından gelir", async () => {
  await mount();
  const logo = host.querySelector("img[src='/brand/tamkobi-mark.svg']");
  expect(logo).not.toBeNull();
  expect(host.textContent).toContain("TamKobi");
  expect(host.textContent).toContain("Bayi Portalı");
});

test("390px üst bar seçici, sepet ikonu ve avatar; bakiye tam genişlik; masaüstü etiketleri gizli", async () => {
  window.innerWidth = 390;
  setMedia(true);
  await mount();
  const bar = host.querySelector("[data-testid='b2b-header-bar']");
  expect(bar.querySelector("[data-testid='b2b-switch-supplier']")).not.toBeNull();
  expect(bar.querySelector("[data-testid='b2b-header-cart']")).not.toBeNull();
  expect(bar.querySelector("[data-testid='b2b-header-cart']").textContent).not.toContain("Sepet");
  expect(bar.querySelector("[data-testid='b2b-account-avatar']")).not.toBeNull();
  expect(bar.textContent).not.toContain("Bayi Portalı");
  expect(bar.textContent).not.toContain("B2B");
  expect(bar.textContent).toContain("MATEK DEKORASYON MOBİLYA");
  const balance = host.querySelector("[data-testid='b2b-header-balance']");
  expect(balance.className).toMatch(/w-full/);
  expect(bar.contains(balance)).toBe(false);
  expect(balance.querySelector("[data-testid='b2b-balance']").className).toMatch(/text-\[24px\]/);
  expect(host.querySelector("[data-testid='b2b-contact-name']").className).toMatch(/sr-only/);
  await act(async () => { host.querySelector("[data-testid='b2b-switch-supplier']").click(); });
  const menu = host.querySelector("[data-testid='b2b-switch-menu']");
  expect(menu.className).toMatch(/inset-x-2/);
});

test("menü dışarı tıklama ve Esc ile kapanır, aynı anda tek menü açık kalır", async () => {
  await mount();
  await act(async () => { host.querySelector("[data-testid='b2b-switch-supplier']").click(); });
  expect(host.querySelector("[data-testid='b2b-switch-menu']")).not.toBeNull();
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
  expect(host.querySelector("[data-testid='b2b-switch-menu']")).toBeNull();
  expect(host.querySelector("[data-testid='b2b-account-menu']")).not.toBeNull();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector("[data-testid='b2b-account-menu']")).toBeNull();
  await act(async () => { host.querySelector("[data-testid='b2b-account-trigger']").click(); });
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(host.querySelector("[data-testid='b2b-account-menu']")).toBeNull();
});
