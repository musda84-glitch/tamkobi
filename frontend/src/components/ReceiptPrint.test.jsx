/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ReceiptPrint } from "./ReceiptPrint";
import { fmtMoney } from "../utils/money";

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
  expect(heads).toEqual(["Tür", "Çek/Senet No", "Banka/Şube", "Hesap No/IBAN", "Keşideci", "Vade", "Tutar"]);
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
