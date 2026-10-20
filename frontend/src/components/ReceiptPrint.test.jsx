/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ReceiptPrint } from "./ReceiptPrint";
import { fmtMoney } from "../utils/money";
import {
  RECEIPT_HALF_MAX_ROWS,
  measureReceiptProbe,
  receiptCopyPages,
  receiptDensity,
  receiptFitsHalf,
  receiptHalfLimitPx,
  receiptHalfOverflows,
} from "../utils/receiptLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = {
  name: "Tam Kobi A.Ş.",
  address: "Caferağa",
  city: "İstanbul",
  tax_office: "Kadıköy",
  tax_number: "1234567890",
  phone: "0216 000 00 00",
};
const CONTACT = {
  name: "Acme Ltd.",
  tax_number_or_id: "11111111111",
  address: "Moda",
  city: "İstanbul",
  balance: 250,
  currency: "TRY",
};
const CASH_TX = {
  id: "abcdef1234567890",
  type: "inflow",
  date: "2026-10-20",
  amount: 1500,
  currency: "TRY",
  description: "Nakit tahsilat",
  account_name: "Merkez Kasa",
  category: "Tahsilat",
};
const CHEQUES = [
  {
    id: "ch1",
    instrument: "cheque",
    serial_no: "SN-1",
    number: "CEK-1",
    bank_name: "Garanti",
    bank_branch: "Levent",
    account_no: "TR0001",
    drawer_name: "Ali Veli",
    due_date: "2026-12-01",
    amount: 100,
  },
  {
    id: "ch2",
    instrument: "promissory",
    serial_no: "",
    number: "SNT-2",
    bank_name: "",
    bank_branch: "",
    account_no: "",
    drawer_name: "",
    due_date: "",
    amount: 200.5,
  },
  {
    id: "ch3",
    instrument: "cheque",
    number: "CEK-3",
    bank_name: "Akbank",
    bank_branch: "Kadıköy",
    account_no: "9988",
    drawer_name: "Ayşe",
    due_date: "2026-11-02",
    amount: 50,
  },
];

let host;
let root;

function mount(props) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<ReceiptPrint onClose={() => {}} contact={CONTACT} company={COMPANY} {...props} />);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

function setCopies(n) {
  const select = document.querySelector("[data-testid=receipt-copy-count]");
  act(() => {
    select.value = String(n);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("logo_url varken img var, yokken logo alanı yok", () => {
  mount({
    tx: CASH_TX,
    company: { ...COMPANY, logo_url: "https://cdn.example/logo.png" },
  });
  const img = document.querySelector("[data-testid=receipt-logo]");
  expect(img).toBeTruthy();
  expect(img.getAttribute("src")).toBe("https://cdn.example/logo.png");
  expect(document.querySelectorAll("#print-area img")).toHaveLength(1);
  act(() => { img.dispatchEvent(new Event("error", { bubbles: true })); });
  expect(img.style.display).toBe("none");

  act(() => { root.unmount(); });
  mount({ tx: CASH_TX, company: COMPANY });
  expect(document.querySelector("#print-area img")).toBeNull();
  expect(document.querySelector("[data-testid=receipt-logo]")).toBeNull();
});

test("3 çek tek makbuzda 7 sütun, adet, toplam ve yalnızca", () => {
  mount({
    tx: { ...CASH_TX, id: "chequegrp1", amount: 350.5, account_name: "Çek Portföyü", category: "Alınan Çek / Senet" },
    items: CHEQUES,
  });
  const heads = [...document.querySelectorAll("[data-testid=receipt-cheque-table] th")].map((th) => th.textContent);
  expect(heads).toEqual(["Tür", "No", "Banka/Şube", "Hesap/IBAN", "Keşideci", "Vade", "Tutar"]);
  const table = document.querySelector("[data-testid=receipt-cheque-table]").textContent;
  expect(table).toContain("Çek");
  expect(table).toContain("Senet");
  expect(table).toContain("SN-1");
  expect(table).toContain("SNT-2");
  expect(table).toContain("Garanti / Levent");
  expect(table).toContain("TR0001");
  expect(table).toContain("Ali Veli");
  expect(table).toContain("01.12.2026");
  expect(table).toContain("—");
  expect(document.querySelector("[data-testid=receipt-doc-count]").textContent).toContain("Toplam 3 adet evrak");
  expect(document.querySelector("[data-testid=receipt-grand-total]").textContent).toContain(fmtMoney(350.5, "TRY"));
  expect(document.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
  expect(document.querySelector("[data-testid=receipt-amount-words]").textContent).toContain("Üç Yüz Elli Türk Lirası Elli Kuruş");
  expect(document.querySelector("[data-testid=receipt-simple-table]")).toBeNull();
  expect(document.body.textContent).not.toContain("İşlem sonrası cari bakiye");
});

test("nakit tek satır, çek tablosu yok, yalnızca satırı var, cari bakiye yok", () => {
  mount({ tx: CASH_TX });
  expect(document.querySelector("[data-testid=receipt-simple-table]")).toBeTruthy();
  expect(document.querySelector("[data-testid=receipt-simple-table]").textContent).toContain("Açıklama");
  expect(document.querySelector("[data-testid=receipt-simple-table]").textContent).toContain("Nakit tahsilat");
  expect(document.querySelector("[data-testid=receipt-simple-table]").textContent).toContain(fmtMoney(1500, "TRY"));
  expect(document.querySelector("[data-testid=receipt-cheque-table]")).toBeNull();
  expect(document.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
  expect(document.body.textContent).toContain("Sayın (Ödeyen)");
  expect(document.body.textContent).toContain("Ödeme Şekli");
  expect(document.body.textContent).toContain("TAHSİLAT MAKBUZU");
  expect(document.body.textContent).toContain("No: MKB-ABCDEF12");
  expect(document.body.textContent).not.toContain("İşlem sonrası cari bakiye");
  expect(document.body.textContent).not.toContain("Çek/Senet No");
});

test("nüsha 1 A5, 2 A4 iki nüsha ve kesim, 5 üç sayfa", () => {
  mount({ tx: CASH_TX });
  const style = () => document.querySelector("[data-testid=receipt-print-style]").textContent;
  expect(document.querySelector("[data-testid=receipt-copy-count]").value).toBe("1");
  expect(style()).toContain("size: A5");
  expect(style()).not.toContain("size: A4");
  expect(document.querySelectorAll("[data-testid=receipt-page]")).toHaveLength(1);
  expect(document.querySelector("[data-testid=receipt-cut]")).toBeNull();
  expect(document.querySelector("[data-testid=receipt-copy-badge-0]").textContent).toBe("Asıl Nüsha");

  setCopies(2);
  expect(style()).toContain("size: A4");
  expect(style()).not.toContain("size: A5");
  expect(document.querySelectorAll("[data-testid=receipt-page]")).toHaveLength(1);
  expect(document.querySelector("[data-copy-count='2']")).toBeTruthy();
  expect(document.querySelectorAll("[data-testid=receipt-cut]")).toHaveLength(1);
  expect(document.querySelector("[data-testid=receipt-cut]").textContent).toContain("kesiniz");
  expect(document.querySelector("[data-testid=receipt-copy-badge-0]").textContent).toBe("Asıl Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-badge-1]").textContent).toBe("2. Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).not.toContain("receipt-print-only");
  expect(document.querySelector("[data-testid=receipt-copy-1]").className).toContain("receipt-print-only");

  setCopies(4);
  const pages4 = [...document.querySelectorAll("[data-testid=receipt-page]")];
  expect(pages4).toHaveLength(2);
  expect(pages4[1].getAttribute("data-copy-count")).toBe("2");
  expect(pages4[1].querySelector("[data-testid=receipt-cut]")).toBeTruthy();

  setCopies(5);
  const pages = [...document.querySelectorAll("[data-testid=receipt-page]")];
  expect(pages).toHaveLength(3);
  expect(pages.map((p) => p.getAttribute("data-copy-count"))).toEqual(["2", "2", "1"]);
  expect(style()).toContain("size: A4");
  expect(document.querySelector("[data-testid=receipt-copy-badge-2]").textContent).toBe("3. Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-badge-4]").textContent).toBe("5. Nüsha");
  expect(document.querySelectorAll("[data-testid=receipt-cut]")).toHaveLength(2);
  expect(document.body.textContent).not.toContain("İşlem sonrası cari bakiye");
});

function makeCheques(n, drawer = "ERSAY HOME ÜRETİM TEDARİK İÇ VE DIŞ TİCARET LİMİTED ŞTİ.") {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    instrument: i % 2 ? "promissory" : "cheque",
    serial_no: `SN-${1000 + i}`,
    bank_name: "Garanti",
    bank_branch: "Levent",
    account_no: "TR330006100519786457841326",
    drawer_name: drawer,
    due_date: "2026-11-30",
    amount: 250000,
  }));
}

test("3 çek tablosu sabit kolon, keşideci iki satır, vade ve tutar tek satır", () => {
  mount({
    tx: { ...CASH_TX, id: "chequegrp1", account_name: "Çek Portföyü", category: "Alınan Çek / Senet" },
    contact: { ...CONTACT, phone: "0532 111 22 33" },
    items: makeCheques(3),
  });
  const table = document.querySelector("[data-testid=receipt-cheque-table]");
  const cols = [...table.querySelectorAll("col")];
  expect(cols).toHaveLength(7);
  expect(cols.map((col) => col.style.width)).toEqual(["8%", "11%", "16%", "17%", "24%", "10%", "14%"]);
  const row = table.querySelector("tbody tr");
  expect(row.querySelector(".receipt-col-drawer .receipt-clamp").textContent).toContain("ERSAY HOME");
  expect(row.querySelector(".receipt-col-drawer .receipt-clamp").getAttribute("title")).toContain("LİMİTED ŞTİ.");
  expect(row.querySelector(".receipt-col-no").className).toContain("receipt-col-nowrap");
  expect(row.querySelector(".receipt-col-due").className).toContain("receipt-col-nowrap");
  expect(row.querySelector(".receipt-col-amount").className).toContain("receipt-col-nowrap");
  expect(row.querySelector(".receipt-col-account").textContent).toContain("TR330006100519786457841326");
  expect(row.querySelector(".receipt-col-due").textContent).toBe("30.11.2026");
  expect(row.querySelector(".receipt-col-amount").textContent).toContain("250.000,00");
  const companyMeta = document.querySelector(".receipt-company-meta");
  expect(companyMeta.textContent).toContain("VKN:");
  expect(companyMeta.textContent).toContain(COMPANY.tax_number);
  expect(companyMeta.textContent).toContain(COMPANY.phone);
  const partyMeta = document.querySelector(".receipt-party-meta");
  expect(partyMeta.textContent).toContain("VKN/TCKN:");
  expect(partyMeta.textContent).toContain(CONTACT.tax_number_or_id);
  expect(partyMeta.textContent).toContain("0532 111 22 33");
  expect(document.querySelectorAll(".receipt-clamp-2").length).toBeGreaterThanOrEqual(2);
  document.querySelectorAll(".receipt-clamp-2").forEach((el) => {
    expect(el.className).toContain("receipt-clamp-2");
  });
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).toContain("receipt-density-normal");
});

test("yoğunluk sınıfı satır sayısına göre değişir", () => {
  mount({ tx: CASH_TX, items: makeCheques(2) });
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).toContain("receipt-density-normal");

  act(() => {
    root.render(<ReceiptPrint tx={CASH_TX} contact={CONTACT} company={COMPANY} onClose={() => {}} items={makeCheques(5)} />);
  });
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).toContain("receipt-density-compact");

  act(() => {
    root.render(<ReceiptPrint tx={CASH_TX} contact={CONTACT} company={COMPANY} onClose={() => {}} items={makeCheques(9)} />);
  });
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).toContain("receipt-density-dense");
});

test("2 nüsha sığınca tek sayfa ve kesim, sığmayınca her nüsha ayrı sayfa", () => {
  mount({ tx: CASH_TX, items: makeCheques(3) });
  setCopies(2);
  expect(document.querySelectorAll("[data-testid=receipt-page]")).toHaveLength(1);
  expect(document.querySelector("[data-copy-count='2']")).toBeTruthy();
  expect(document.querySelectorAll("[data-testid=receipt-cut]")).toHaveLength(1);
  expect(document.querySelector("[data-testid=receipt-copy-badge-0]").textContent).toBe("Asıl Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-badge-1]").textContent).toBe("2. Nüsha");

  act(() => {
    root.render(
      <ReceiptPrint
        tx={CASH_TX}
        contact={CONTACT}
        company={COMPANY}
        onClose={() => {}}
        items={makeCheques(RECEIPT_HALF_MAX_ROWS + 1)}
      />,
    );
  });
  setCopies(2);
  const pages = [...document.querySelectorAll("[data-testid=receipt-page]")];
  expect(pages).toHaveLength(2);
  expect(pages.map((page) => page.getAttribute("data-copy-count"))).toEqual(["1", "1"]);
  expect(document.querySelector("[data-testid=receipt-cut]")).toBeNull();
  expect(document.querySelector("[data-testid=receipt-copy-badge-0]").textContent).toBe("Asıl Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-badge-1]").textContent).toBe("2. Nüsha");
  expect(document.querySelector("[data-testid=receipt-copy-0]").className).toContain("receipt-density-dense");
});

test("ölçülen yükseklik yarı A4'ü aşıyorsa 2 nüsha ayrılır", () => {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() { return 900; },
  });
  try {
    mount({ tx: CASH_TX, items: makeCheques(3) });
    setCopies(2);
    const pages = [...document.querySelectorAll("[data-testid=receipt-page]")];
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.getAttribute("data-copy-count"))).toEqual(["1", "1"]);
    expect(document.querySelector("[data-testid=receipt-cut]")).toBeNull();
    expect(document.querySelector("[data-testid=receipt-copy-badge-0]").textContent).toBe("Asıl Nüsha");
    expect(document.querySelector("[data-testid=receipt-copy-badge-1]").textContent).toBe("2. Nüsha");
  } finally {
    if (desc) Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
    else delete HTMLElement.prototype.scrollHeight;
  }
});

test("makbuz yerleşim yardımcıları yoğunluk, sığma ve 5 nüshaya kadar sayfalar", () => {
  expect(receiptDensity(0)).toBe("normal");
  expect(receiptDensity(2)).toBe("normal");
  expect(receiptDensity(3)).toBe("normal");
  expect(receiptDensity(4)).toBe("compact");
  expect(receiptDensity(5)).toBe("compact");
  expect(receiptDensity(6)).toBe("compact");
  expect(receiptDensity(7)).toBe("dense");
  expect(receiptDensity(9)).toBe("dense");

  expect(receiptHalfOverflows(0)).toBe(false);
  expect(receiptHalfOverflows(Number.NaN)).toBe(false);
  expect(receiptHalfOverflows(receiptHalfLimitPx())).toBe(false);
  expect(receiptHalfOverflows(receiptHalfLimitPx() + 1)).toBe(true);
  expect(receiptFitsHalf(3, 0)).toBe(true);
  expect(receiptFitsHalf(RECEIPT_HALF_MAX_ROWS, 0)).toBe(true);
  expect(receiptFitsHalf(RECEIPT_HALF_MAX_ROWS + 1, 0)).toBe(false);
  expect(receiptFitsHalf(2, receiptHalfLimitPx() + 1)).toBe(false);

  expect(receiptCopyPages(1)).toEqual([[0]]);
  expect(receiptCopyPages(2)).toEqual([[0, 1]]);
  expect(receiptCopyPages(3)).toEqual([[0, 1], [2]]);
  expect(receiptCopyPages(4)).toEqual([[0, 1], [2, 3]]);
  expect(receiptCopyPages(5)).toEqual([[0, 1], [2, 3], [4]]);
  expect(receiptCopyPages(8)).toEqual([[0, 1], [2, 3], [4]]);
  expect(receiptCopyPages(2, { fitsHalf: false })).toEqual([[0], [1]]);
  expect(receiptCopyPages(5, { fitsHalf: false })).toEqual([[0], [1], [2], [3], [4]]);
  expect(receiptCopyPages(0)).toEqual([[0]]);
  expect(measureReceiptProbe(null)).toBe(0);
});

test("borç alacak fişi, bakiye düzeltme ve virman başlıkları korunur", () => {
  const base = { id: "slip1111", date: "2026-10-01", amount: 20, account_name: "Kasa", description: "Fiş", currency: "TRY" };
  mount({ tx: { ...base, source: "ledger", purpose: "ledger_slip", slip_kind: "debit", type: "outflow" } });
  expect(document.body.textContent).toContain("BORÇ FİŞİ");

  act(() => {
    root.render(
      <ReceiptPrint
        tx={{ ...base, source: "ledger", purpose: "ledger_slip", slip_kind: "credit", type: "inflow" }}
        contact={CONTACT}
        company={COMPANY}
        onClose={() => {}}
      />,
    );
  });
  expect(document.body.textContent).toContain("ALACAK FİŞİ");

  act(() => {
    root.render(
      <ReceiptPrint
        tx={{ ...base, purpose: "balance_fix", slip_kind: "credit", type: "inflow", description: "Cari bakiye düzeltme" }}
        contact={CONTACT}
        company={COMPANY}
        onClose={() => {}}
      />,
    );
  });
  expect(document.body.textContent).toContain("CARİ BAKİYE DÜZELTME (ALACAK)");

  act(() => {
    root.render(
      <ReceiptPrint
        tx={{ ...base, type: "transfer", target_account_name: "Banka" }}
        contact={CONTACT}
        company={COMPANY}
        onClose={() => {}}
      />,
    );
  });
  expect(document.body.textContent).toContain("VİRMAN MAKBUZU");
  expect(document.body.textContent).not.toContain("İşlem sonrası cari bakiye");
});
