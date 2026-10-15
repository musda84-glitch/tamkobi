import { post, put } from "../api/client";
import {
  canFaturalastirDraftInvoice,
  DRAFT_FATURALASTIR_TYPES,
  draftFaturalastirNeedsOnay,
  issueInvoiceFromOnay,
  postIncomingPurchaseInvoice,
} from "./invoiceFaturalastir";

jest.mock("../api/client", () => ({
  post: jest.fn(),
  put: jest.fn(),
}));
jest.mock("./invoiceIssueNow", () => ({
  nowIssueDateTime: () => ({ issue_date: "2026-10-14", issue_time: "12:00:00" }),
}));

const mockedPost = post as jest.MockedFunction<typeof post>;
const mockedPut = put as jest.MockedFunction<typeof put>;

describe("canFaturalastirDraftInvoice", () => {
  it("allows sales drafts that are not GİB-issued", () => {
    expect(canFaturalastirDraftInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "e_archive",
    })).toBe(true);
    expect(canFaturalastirDraftInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "paper",
    })).toBe(true);
  });

  it("hides the action on issued, purchase, dispatch and non-draft invoices", () => {
    expect(canFaturalastirDraftInvoice({
      status: "approved",
      invoice_type: "sales",
      e_type: "e_invoice",
    })).toBe(false);
    expect(canFaturalastirDraftInvoice({
      status: "draft",
      invoice_type: "purchase",
      e_type: "e_invoice",
      direction: "incoming",
    })).toBe(false);
    expect(canFaturalastirDraftInvoice({
      status: "draft",
      invoice_type: "dispatch",
      e_type: "e_dispatch",
    })).toBe(false);
    expect(canFaturalastirDraftInvoice({
      status: "draft",
      invoice_type: "sales",
      e_type: "e_invoice",
      einvoice_state: "sent",
      gib_uuid: "u1",
    })).toBe(false);
    expect(canFaturalastirDraftInvoice(null)).toBe(false);
  });
});

describe("draft Faturalaştır types", () => {
  it("lists E-Fatura, E-Arşiv, export and paper", () => {
    expect(DRAFT_FATURALASTIR_TYPES.map((t) => t.key)).toEqual([
      "e_invoice",
      "e_archive",
      "e_export",
      "paper",
    ]);
    expect(DRAFT_FATURALASTIR_TYPES.find((t) => t.key === "paper")?.label).toMatch(/kağıt/i);
  });

  it("opens the shared onay modal for GİB e-belge types", () => {
    expect(draftFaturalastirNeedsOnay("e_invoice")).toBe(true);
    expect(draftFaturalastirNeedsOnay("e_archive")).toBe(true);
    expect(draftFaturalastirNeedsOnay("auto")).toBe(true);
    expect(draftFaturalastirNeedsOnay("paper")).toBe(false);
    expect(draftFaturalastirNeedsOnay("e_export")).toBe(false);
  });
});

describe("issueInvoiceFromOnay", () => {
  const client = { baseUrl: "https://example.test", token: "t" };

  beforeEach(() => {
    mockedPost.mockReset();
    mockedPut.mockReset();
    mockedPost.mockResolvedValue({});
    mockedPut.mockResolvedValue({});
  });

  it("stamps date/time then send-to-gib with selected e-type and scenario", async () => {
    await issueInvoiceFromOnay(
      client,
      { id: "inv_1", contact_id: "cnt_1" },
      { eType: "e_invoice", scenario: "TICARI", stampNow: true },
    );
    expect(mockedPut).toHaveBeenCalledWith(client, "/invoices/inv_1", {
      issue_date: "2026-10-14",
      issue_time: "12:00:00",
    });
    expect(mockedPost).toHaveBeenCalledWith(client, "/invoices/inv_1/send-to-gib", {
      e_type: "e_invoice",
      scenario: "TICARI",
      stamp_now: true,
      issue_date: "2026-10-14",
      issue_time: "12:00:00",
    });
  });

  it("saves alias then issues e-archive without extra stamp", async () => {
    await issueInvoiceFromOnay(
      client,
      { _id: "inv_2", contact_id: "cnt_2" },
      { eType: "e_archive", alias: "urn:mail:alias@pk" },
    );
    expect(mockedPut).toHaveBeenCalledWith(client, "/contacts/cnt_2", {
      e_invoice_alias: "urn:mail:alias@pk",
      is_e_invoice_user: false,
    });
    expect(mockedPost).toHaveBeenCalledWith(client, "/invoices/inv_2/send-to-gib", {
      e_type: "e_archive",
    });
  });
});

describe("postIncomingPurchaseInvoice", () => {
  const client = { baseUrl: "https://example.test", token: "t" };
  const draft = {
    id: "inv_in",
    status: "draft",
    invoice_type: "purchase",
    direction: "incoming",
    e_type: "e_invoice",
    effects_applied: false,
  };

  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({});
  });

  it("posts the purchase once through approve and does not resend to GİB", async () => {
    await postIncomingPurchaseInvoice(client, draft);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(client, "/invoices/inv_in/approve");
    expect(mockedPost.mock.calls.some((c) => String(c[1]).includes("send-to-gib"))).toBe(false);
  });

  it("does not post again when the invoice is already on the ledger", async () => {
    await postIncomingPurchaseInvoice(client, {
      ...draft,
      status: "approved",
      effects_applied: true,
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
