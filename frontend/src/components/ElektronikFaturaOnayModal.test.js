import { describe, expect, it } from "@jest/globals";
import {
  buildIadeNote,
  createOnayProgressApi,
  DEFAULT_PRINT_FLOW,
  DEFAULT_SEND_FLOW,
  isReturnInvoiceDoc,
  makeFlowState,
  prefillReturnBillingRef,
} from "./ElektronikFaturaOnayModal";

describe("isReturnInvoiceDoc", () => {
  it("detects return types", () => {
    expect(isReturnInvoiceDoc({ invoice_type: "return" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "sales_return" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "İade" })).toBe(true);
    expect(isReturnInvoiceDoc({ invoice_type: "sales" })).toBe(false);
  });
});

describe("prefillReturnBillingRef", () => {
  it("uses original_invoice fields", () => {
    expect(
      prefillReturnBillingRef({
        original_invoice_number: "U052026000000065",
        original_issue_date: "2026-09-29",
      }),
    ).toEqual({ number: "U052026000000065", date: "2026-09-29" });
  });

  it("parses from notes when fields missing", () => {
    expect(
      prefillReturnBillingRef({
        notes: "29.09.2026 tarihli GHJ2026000002586 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
      }),
    ).toEqual({ number: "GHJ2026000002586", date: "2026-09-29" });
  });
});

describe("buildIadeNote", () => {
  it("formats TR note for BillingReference fallback", () => {
    expect(buildIadeNote("u052026000000065", "2026-09-29")).toBe(
      "29.09.2026 tarihli U052026000000065 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
    );
  });
});

describe("onay progress flow helpers", () => {
  it("makeFlowState starts all pending", () => {
    const steps = makeFlowState(DEFAULT_SEND_FLOW);
    expect(steps).toHaveLength(4);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(makeFlowState(DEFAULT_PRINT_FLOW)).toHaveLength(3);
  });

  it("setStep marks prior steps done and target active", () => {
    let flow = makeFlowState(DEFAULT_SEND_FLOW);
    let items = [];
    const setFlow = (fn) => { flow = typeof fn === "function" ? fn(flow) : fn; };
    const setItems = (fn) => { items = typeof fn === "function" ? fn(items) : fn; };
    const api = createOnayProgressApi(setFlow, setItems);
    api.setStep("prepare", "active");
    expect(flow.find((s) => s.id === "prepare").status).toBe("active");
    api.setStep("send", "active");
    expect(flow.find((s) => s.id === "prepare").status).toBe("done");
    expect(flow.find((s) => s.id === "send").status).toBe("active");
    api.initItems([{ id: "a", label: "F1", contact_name: "Cari" }]);
    api.setItem("a", { status: "ok", detail: "Gönderildi" });
    expect(items[0]).toMatchObject({ id: "a", status: "ok", detail: "Gönderildi", sublabel: "Cari" });
  });

  it("send flow includes gib refresh step used by mini ticker", () => {
    expect(DEFAULT_SEND_FLOW.map((s) => s.id)).toEqual(["prepare", "send", "refresh", "done"]);
    expect(DEFAULT_SEND_FLOW.find((s) => s.id === "send").label).toMatch(/GİB/);
  });
});
