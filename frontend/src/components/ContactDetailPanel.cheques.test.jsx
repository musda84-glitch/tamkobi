/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ContactDetailPanel } from "./ContactDetailPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: impl };
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));

jest.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...rest }) => (
    <button type="button" disabled={!!disabled} onClick={() => !disabled && onSelect?.()} {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuSubContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
}));

jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1", name: "Tam Kobi" }, can: () => true }),
}));

const CHEQUES = [
  {
    id: "ch1",
    number: "CEK-1",
    instrument: "cheque",
    direction: "received",
    amount: 100,
    currency: "TRY",
    serial_no: "SN-1",
    bank_name: "Garanti",
    bank_branch: "Levent",
    account_no: "TR1",
    drawer_name: "Ali",
    due_date: "2026-12-01",
    issue_date: "2026-10-01",
    status: "open",
  },
  {
    id: "ch2",
    number: "SNT-2",
    instrument: "promissory",
    direction: "received",
    amount: 50.5,
    currency: "TRY",
    serial_no: "SN-2",
    bank_name: "İş",
    bank_branch: "Kadıköy",
    account_no: "TR2",
    drawer_name: "Ayşe",
    due_date: "2026-12-15",
    issue_date: "2026-10-02",
    status: "open",
  },
  {
    id: "ch3",
    number: "CEK-3",
    instrument: "cheque",
    direction: "issued",
    amount: 80,
    currency: "TRY",
    serial_no: "SN-3",
    bank_name: "Akbank",
    bank_branch: "Beşiktaş",
    account_no: "TR3",
    drawer_name: "Firma",
    due_date: "2026-11-01",
    issue_date: "2026-09-01",
    status: "open",
  },
  {
    id: "ch4",
    number: "CEK-4",
    instrument: "cheque",
    direction: "received",
    amount: 20,
    currency: "USD",
    serial_no: "SN-4",
    bank_name: "Garanti",
    bank_branch: "Levent",
    account_no: "TR4",
    drawer_name: "Ali",
    due_date: "2026-12-20",
    issue_date: "2026-10-04",
    status: "open",
  },
];

const OVERVIEW = {
  contact: { id: "ct1", company_id: "c1", name: "Acme", type: "customer", balance: 100, tax_number_or_id: "111" },
  summary: { total_invoiced: 0, total_paid: 0, open_amount: 0, invoice_count: 0, draft_count: 0, opening_balance: 0 },
  invoices: [],
  payments: [
    {
      id: "pay-cheque",
      type: "inflow",
      date: "2026-10-01",
      account_name: "Çek Portföyü",
      category: "Alınan Çek",
      description: "CEK-1",
      amount: 100,
      currency: "TRY",
      source: "cheque",
      cheque_id: "ch1",
    },
    {
      id: "pay-cash",
      type: "inflow",
      date: "2026-10-03",
      account_name: "Kasa",
      category: "Tahsilat",
      description: "Nakit tahsilat",
      amount: 40,
      currency: "TRY",
      source: "manual",
    },
  ],
  orders: [],
  communications: [],
  quotes: [],
  surveys: [],
  cheques: CHEQUES,
  projects: [],
  email_deliveries: [],
};

let host;
let root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) return Promise.resolve({ data: OVERVIEW });
    return Promise.resolve({ data: [] });
  });
  toast.error.mockClear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPanel() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ContactDetailPanel contactId="ct1" onClose={() => {}} />
      </MemoryRouter>,
    );
  });
  await flush(8);
}

test("seçilen aynı yön çeklerle tek makbuz items taşır", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  expect(host.querySelector("[data-testid=detail-cheques-receipt-selected]").disabled).toBe(true);
  expect(host.querySelector("[data-testid=detail-cheque-select-CEK-1]")).toBeTruthy();

  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-1]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-SNT-2]").click(); });
  expect(host.querySelector("[data-testid=detail-cheques-receipt-selected]").disabled).toBe(false);
  await act(async () => { host.querySelector("[data-testid=detail-cheques-receipt-selected]").click(); });

  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("SN-1");
  expect(table.textContent).toContain("SN-2");
  expect(table.textContent).not.toContain("SN-3");
  expect(host.textContent).toContain("Toplam 2 adet evrak");
  expect(host.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
  expect(host.textContent).not.toContain("İşlem sonrası cari bakiye");
});

test("karışık para birimi seçilince makbuz açılmaz", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-1]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-4]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheques-receipt-selected]").click(); });
  expect(toast.error).toHaveBeenCalledWith("Aynı para birimindeki çek ve senetleri seçin.");
  expect(host.querySelector("[data-testid=receipt-print-modal]")).toBeNull();
});

test("karışık yön seçilince makbuz açılmaz", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-cheques]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-1]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheque-select-CEK-3]").click(); });
  await act(async () => { host.querySelector("[data-testid=detail-cheques-receipt-selected]").click(); });
  expect(toast.error).toHaveBeenCalled();
  expect(host.querySelector("[data-testid=receipt-print-modal]")).toBeNull();
});

test("ödeme satırı çek kaynağındaysa eşleşen çeki items olarak geçirir", async () => {
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  const chequeBtn = host.querySelector("[data-testid=receipt-btn-pay-cheque]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-cheque]");
  await act(async () => { chequeBtn.click(); });
  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("SN-1");
  expect(table.textContent).toContain("Garanti / Levent");
  expect(host.textContent).toContain("Toplam 1 adet evrak");

  await act(async () => { host.querySelector("[data-testid=receipt-close-btn]").click(); });
  const cashBtn = host.querySelector("[data-testid=receipt-btn-pay-cash]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-cash]");
  await act(async () => { cashBtn.click(); });
  expect(host.querySelector("[data-testid=receipt-cheque-table]")).toBeNull();
  expect(host.querySelector("[data-testid=receipt-simple-table]").textContent).toContain("Nakit tahsilat");
  expect(host.querySelector("[data-testid=receipt-amount-words]").textContent).toMatch(/^Yalnız: /);
});

function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function openChequeForm() {
  await act(async () => { host.querySelector("[data-testid=detail-collect-cheque]").click(); });
  await flush(6);
  expect(host.querySelector("[data-testid=collect-modal]")).toBeTruthy();
  expect(host.querySelector("[data-testid=pay-cheque-row-0]")).toBeTruthy();
}

test("çoklu çek satırı eklenir silinir ve toplam kilitlenir", async () => {
  await renderPanel();
  await openChequeForm();
  expect(host.querySelector("[data-testid=pay-cheque-remove-row-0]").disabled).toBe(true);
  expect(host.querySelector("[data-testid=pay-cheque-total]").readOnly).toBe(true);

  await act(async () => { host.querySelector("[data-testid=pay-cheque-add-row]").click(); });
  await act(async () => { host.querySelector("[data-testid=pay-cheque-add-row]").click(); });
  expect(host.querySelector("[data-testid=pay-cheque-row-2]")).toBeTruthy();

  typeInto(host.querySelector("[data-testid=pay-cheque-amount-0]"), "100");
  typeInto(host.querySelector("[data-testid=pay-cheque-amount-1]"), "50");
  typeInto(host.querySelector("[data-testid=pay-cheque-amount-2]"), "25");
  expect(host.querySelector("[data-testid=pay-cheque-total]").value).toBe("175.00");

  await act(async () => { host.querySelector("[data-testid=pay-cheque-remove-row-2]").click(); });
  expect(host.querySelector("[data-testid=pay-cheque-row-2]")).toBeNull();
  expect(host.querySelector("[data-testid=pay-cheque-total]").value).toBe("150.00");
});

test("çoklu çek kaydı batch çağırır ve makbuzda N satır gösterir", async () => {
  axios.post.mockImplementation(async (url, body) => {
    if (String(url).includes("/cheques/batch")) {
      const items = (body.items || []).map((item, i) => ({
        id: `new-${i}`,
        number: `CEK-N-${i + 1}`,
        instrument: item.instrument,
        direction: body.direction,
        amount: item.amount,
        currency: "TRY",
        serial_no: item.serial_no,
        bank_name: item.bank_name,
        bank_branch: "Levent",
        account_no: `TR${i}`,
        drawer_name: "Ali",
        due_date: item.due_date,
        issue_date: "2026-10-20",
        status: "open",
      }));
      return { data: { receipt_group_id: "grp-new", items, total: items.reduce((sum, row) => sum + Number(row.amount || 0), 0) } };
    }
    return { data: {} };
  });
  await renderPanel();
  await openChequeForm();
  await act(async () => { host.querySelector("[data-testid=pay-cheque-add-row]").click(); });
  typeInto(host.querySelector("[data-testid=pay-cheque-amount-0]"), "100");
  typeInto(host.querySelector("[data-testid=pay-cheque-amount-1]"), "40");
  typeInto(host.querySelector("[data-testid=pay-cheque-serial-0]"), "BATCH-1");
  typeInto(host.querySelector("[data-testid=pay-cheque-serial-1]"), "BATCH-2");
  await act(async () => { host.querySelector("[data-testid=collect-save-btn]").click(); });
  await flush(8);

  const batchCall = axios.post.mock.calls.find((call) => String(call[0]).includes("/cheques/batch"));
  expect(batchCall).toBeTruthy();
  expect(batchCall[1].items).toHaveLength(2);
  expect(axios.post.mock.calls.some((call) => String(call[0]).endsWith("/cheques") && !String(call[0]).includes("/batch"))).toBe(false);
  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("BATCH-1");
  expect(table.textContent).toContain("BATCH-2");
  expect(host.textContent).toContain("Toplam 2 adet evrak");
});

test("receipt_group_id makbuzu yereldeki grubu, eksikse GET ile gösterir", async () => {
  const groupCheques = [
    {
      id: "g1",
      receipt_group_id: "grp-9",
      number: "CEK-G1",
      instrument: "cheque",
      direction: "received",
      amount: 10,
      currency: "TRY",
      serial_no: "G-SN-1",
      bank_name: "Ziraat",
      bank_branch: "Merkez",
      account_no: "TRG1",
      drawer_name: "Ali",
      due_date: "2026-12-01",
      issue_date: "2026-10-01",
      status: "open",
    },
    {
      id: "g2",
      receipt_group_id: "grp-9",
      number: "CEK-G2",
      instrument: "promissory",
      direction: "received",
      amount: 20,
      currency: "TRY",
      serial_no: "G-SN-2",
      bank_name: "Halk",
      bank_branch: "Kadıköy",
      account_no: "TRG2",
      drawer_name: "Ayşe",
      due_date: "2026-12-02",
      issue_date: "2026-10-02",
      status: "open",
    },
  ];
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) {
      return Promise.resolve({
        data: {
          ...OVERVIEW,
          cheques: groupCheques,
          payments: [
            {
              id: "pay-group",
              type: "inflow",
              date: "2026-10-01",
              account_name: "Çek Portföyü",
              category: "Alınan Çek",
              description: "CEK-G1",
              amount: 10,
              currency: "TRY",
              source: "cheque",
              cheque_id: "g1",
              receipt_group_id: "grp-9",
            },
            OVERVIEW.payments[1],
          ],
        },
      });
    }
    if (u.includes("/cheques/receipt")) {
      return Promise.resolve({ data: { receipt_group_id: "grp-9", cheques: groupCheques, total: 30 } });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  const groupBtn = host.querySelector("[data-testid=receipt-btn-pay-group]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-group]");
  await act(async () => { groupBtn.click(); });
  await flush(4);
  let table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table.textContent).toContain("G-SN-1");
  expect(table.textContent).toContain("G-SN-2");
  expect(host.textContent).toContain("Toplam 2 adet evrak");
  expect(axios.get.mock.calls.some((call) => String(call[0]).includes("/cheques/receipt"))).toBe(false);

  await act(async () => { host.querySelector("[data-testid=receipt-close-btn]").click(); });
  const cashBtn = host.querySelector("[data-testid=receipt-btn-pay-cash]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-cash]");
  await act(async () => { cashBtn.click(); });
  expect(host.querySelector("[data-testid=receipt-cheque-table]")).toBeNull();
  expect(host.querySelector("[data-testid=receipt-simple-table]").textContent).toContain("Nakit tahsilat");
});

test("yerelde grup yoksa makbuz GET /cheques/receipt ile dolar", async () => {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/overview")) {
      return Promise.resolve({
        data: {
          ...OVERVIEW,
          cheques: [],
          payments: [{
            id: "pay-remote",
            type: "inflow",
            date: "2026-10-01",
            account_name: "Çek Portföyü",
            category: "Alınan Çek",
            description: "CEK-R",
            amount: 15,
            currency: "TRY",
            source: "cheque",
            cheque_id: "remote-1",
            receipt_group_id: "grp-remote",
          }],
        },
      });
    }
    if (u.includes("/cheques/receipt")) {
      return Promise.resolve({
        data: {
          receipt_group_id: "grp-remote",
          cheques: [
            {
              id: "remote-1",
              number: "CEK-R1",
              instrument: "cheque",
              direction: "received",
              amount: 15,
              currency: "TRY",
              serial_no: "R-SN-1",
              bank_name: "Vakıf",
              due_date: "2026-12-01",
            },
            {
              id: "remote-2",
              number: "CEK-R2",
              instrument: "cheque",
              direction: "received",
              amount: 35,
              currency: "TRY",
              serial_no: "R-SN-2",
              bank_name: "Deniz",
              due_date: "2026-12-05",
            },
          ],
          total: 50,
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
  await renderPanel();
  await act(async () => { host.querySelector("[data-testid=detail-tab-payments]").click(); });
  const btn = host.querySelector("[data-testid=receipt-btn-pay-remote]")
    || host.querySelector("[data-testid=card-receipt-btn-pay-remote]");
  await act(async () => { btn.click(); });
  await flush(6);
  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("R-SN-1");
  expect(table.textContent).toContain("R-SN-2");
  expect(host.textContent).toContain("Toplam 2 adet evrak");
  expect(axios.get.mock.calls.some((call) => String(call[0]).includes("/cheques/receipt"))).toBe(true);
});

test("tek çek satırı mevcut POST /cheques ile kaydolur ve makbuz açılır", async () => {
  axios.post.mockImplementation(async (url, body) => {
    if (String(url).endsWith("/cheques")) {
      return {
        data: {
          id: "one-1",
          number: "CEK-ONE",
          instrument: body.instrument,
          direction: body.direction,
          amount: body.amount,
          currency: "TRY",
          serial_no: body.serial_no,
          bank_name: body.bank_name,
          due_date: body.due_date,
          issue_date: "2026-10-20",
          status: "open",
          receipt_group_id: "grp-one",
        },
      };
    }
    return { data: {} };
  });
  await renderPanel();
  await openChequeForm();
  typeInto(host.querySelector("[data-testid=pay-cheque-amount-0]"), "80");
  typeInto(host.querySelector("[data-testid=pay-cheque-serial-0]"), "ONE-SN");
  await act(async () => { host.querySelector("[data-testid=collect-save-btn]").click(); });
  await flush(8);
  const single = axios.post.mock.calls.find((call) => String(call[0]).endsWith("/cheques"));
  expect(single).toBeTruthy();
  expect(single[1].amount).toBe(80);
  expect(single[1].serial_no).toBe("ONE-SN");
  expect(axios.post.mock.calls.some((call) => String(call[0]).includes("/cheques/batch"))).toBe(false);
  const table = host.querySelector("[data-testid=receipt-cheque-table]");
  expect(table).toBeTruthy();
  expect(table.textContent).toContain("ONE-SN");
  expect(host.textContent).toContain("Toplam 1 adet evrak");
});
