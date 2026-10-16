import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { printLabelJobs } from "./LabelDesigner";
import { PickLabelPrintHost } from "./PickLabelPrintHost";

const FETCH_MSG = "Etiket şablonları alınamadı (oturum/firma). Hazır şablonla basılsın mı?";

jest.mock("axios", () => {
  const impl = { get: jest.fn(() => Promise.resolve({ data: [] })) };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("./LabelDesigner", () => ({
  builtinTemplates: () => ([
    { id: "builtin-40x20", name: "Hazır 40×20" },
    { id: "builtin-50x30", name: "Hazır 50×30" },
  ]),
  LabelCanvas: () => null,
  printLabelJobs: jest.fn(() => Promise.resolve()),
}));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  toast.success.mockReset();
  printLabelJobs.mockClear();
  window.confirm = jest.fn(() => false);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderHost(props) {
  root = createRoot(host);
  await act(async () => {
    root.render(<PickLabelPrintHost companyId="c1" onDone={jest.fn()} {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForPrint() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

test("template fetch error does not print without confirmation", async () => {
  const onDone = jest.fn();
  window.confirm = jest.fn(() => false);
  axios.get.mockRejectedValue(new Error("401"));
  await renderHost({
    onDone,
    printRequest: {
      id: 1,
      items: [{ product_id: "p1", product_name: "MDF", label_template_id: "tpl_stock" }],
    },
  });
  expect(toast.error).toHaveBeenCalledWith(FETCH_MSG);
  expect(window.confirm).toHaveBeenCalledWith(FETCH_MSG);
  expect(printLabelJobs).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalled();
});

test("template fetch error prints the builtin template after confirmation", async () => {
  window.confirm = jest.fn(() => true);
  axios.get.mockRejectedValue(new Error("401"));
  await renderHost({
    printRequest: {
      id: 4,
      items: [{ product_id: "p1", product_name: "MDF" }],
    },
  });
  await waitForPrint();
  expect(printLabelJobs).toHaveBeenCalledTimes(1);
  expect(printLabelJobs.mock.calls[0][0].id).toBe("builtin-50x30");
});

test("missing assigned template warns once and prints the default", async () => {
  axios.get.mockResolvedValue({
    data: [
      { id: "tpl_a", name: "A", is_default: false },
      { id: "tpl_def", name: "Varsayılan", is_default: true },
    ],
  });
  await renderHost({
    printRequest: {
      id: 2,
      items: [
        { product_id: "p1", product_name: "MDF", label_template_id: "missing", ordered_qty: 2 },
        { product_id: "p1", product_name: "MDF", label_template_id: "missing", ordered_qty: 1 },
      ],
    },
  });
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(toast.warning).toHaveBeenCalledWith("MDF: atanan etiket şablonu bulunamadı, varsayılan kullanıldı");
  expect(window.confirm).not.toHaveBeenCalled();
  await waitForPrint();
  expect(printLabelJobs).toHaveBeenCalledTimes(1);
  expect(printLabelJobs.mock.calls[0][0].id).toBe("tpl_def");
  expect(printLabelJobs.mock.calls[0][1]).toHaveLength(3);
});

test("uses the stock card template when it is in the list", async () => {
  axios.get.mockResolvedValue({
    data: [
      { id: "tpl_def", name: "Varsayılan", is_default: true },
      { id: "tpl_stock", name: "Stok kartı" },
    ],
  });
  await renderHost({
    printRequest: {
      id: 3,
      items: [{ product_id: "p1", product_name: "MDF", label_template_id: "tpl_stock" }],
    },
  });
  expect(toast.warning).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  await waitForPrint();
  expect(printLabelJobs).toHaveBeenCalledTimes(1);
  expect(printLabelJobs.mock.calls[0][0].id).toBe("tpl_stock");
});
