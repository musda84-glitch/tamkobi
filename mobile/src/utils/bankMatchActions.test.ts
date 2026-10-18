import { post } from "../api/client";
import { emptyMatchDraft, matchPayload } from "./bankMatch";
import { replaceMatchDraft, submitMatch, txMatchState, unmatchTx } from "./bankMatchActions";

jest.mock("../api/client", () => ({
  post: jest.fn(async () => ({ ok: true })),
}));

const client = { baseUrl: "https://api.test", token: "tok" };
const tx = { id: "tx-9", type: "inflow", amount: 10, source: "bank_sync", match_status: "unmatched" };

beforeEach(() => {
  (post as unknown as jest.Mock).mockClear();
});

describe("submitMatch", () => {
  it("omits replace when replace is false", async () => {
    const draft = emptyMatchDraft({ suggested_contact_id: "c1" });
    await submitMatch(client, tx, draft, { replace: false });
    expect(post).toHaveBeenCalledTimes(1);
    expect((post as unknown as jest.Mock).mock.calls[0][1]).toBe("/banking/transactions/tx-9/match");
    const body = (post as unknown as jest.Mock).mock.calls[0][2];
    expect(body).toEqual(matchPayload(draft));
    expect(Object.prototype.hasOwnProperty.call(body, "replace")).toBe(false);
  });

  it("sends replace true only when requested", async () => {
    const draft = emptyMatchDraft();
    await submitMatch(client, tx, draft, { replace: true });
    const body = (post as unknown as jest.Mock).mock.calls[0][2];
    expect(body.replace).toBe(true);
    expect(body).toMatchObject(matchPayload(draft));
  });
});

describe("unmatchTx", () => {
  it("posts to the unmatch endpoint", async () => {
    await unmatchTx(client, tx);
    expect(post).toHaveBeenCalledWith(client, "/banking/transactions/tx-9/unmatch", {});
  });
});

describe("replaceMatchDraft", () => {
  it("keeps a cari match on the contact and prefers the saved contact", () => {
    const draft = replaceMatchDraft({
      id: "tx-cari",
      match_status: "matched",
      contact_id: "c-1",
      suggested_contact_id: "c-sug",
      category: "Havale",
      target_account_id: "",
    });
    expect(draft.mode).toBe("contact");
    expect(draft.contact_id).toBe("c-1");
    expect(draft.target_account_id).toBe("");
    expect(draft.category).toBe("Havale");
    expect(draft.learn).toBe(true);
  });

  it("opens a virman match on the target account", () => {
    const draft = replaceMatchDraft({
      id: "tx-virman",
      match_status: "matched",
      contact_id: "",
      target_account_id: "kasa-1",
      category: "Virman",
    });
    expect(draft.mode).toBe("transfer");
    expect(draft.target_account_id).toBe("kasa-1");
    expect(draft.contact_id).toBe("");
    expect(draft.category).toBe("Virman");
  });

  it("opens a category-only match when the movement is matched without a contact", () => {
    const draft = replaceMatchDraft({
      id: "tx-kat",
      match_status: "matched",
      contact_id: "",
      target_account_id: "",
      category: "  Kira  ",
    });
    expect(draft.mode).toBe("category");
    expect(draft.category).toBe("  Kira  ");
    expect(draft.contact_id).toBe("");
    expect(draft.target_account_id).toBe("");
  });

  it("opens an expense match from expense_id or as_expense", () => {
    const fromId = replaceMatchDraft({
      id: "tx-exp",
      match_status: "matched",
      expense_id: "exp-9",
      contact_id: "c-9",
      target_account_id: "kasa-2",
      category: "Yakıt",
    });
    expect(fromId.mode).toBe("expense");
    expect(fromId.category).toBe("Yakıt");
    expect(fromId.contact_id).toBe("c-9");
    expect(fromId.target_account_id).toBe("kasa-2");

    const fromFlag = replaceMatchDraft({
      id: "tx-flag",
      as_expense: true,
      suggested_contact_id: "c-sug",
      category: "Ofis",
    });
    expect(fromFlag.mode).toBe("expense");
    expect(fromFlag.contact_id).toBe("c-sug");
    expect(fromFlag.category).toBe("Ofis");
    expect(fromFlag.target_account_id).toBe("");
  });
});

describe("txMatchState", () => {
  it("returns null unless the movement came from bank sync", () => {
    expect(txMatchState(null)).toBeNull();
    expect(txMatchState({ source: "manual", match_status: "unmatched" })).toBeNull();
    expect(txMatchState({ source: "partner", match_status: "matched" })).toBeNull();
    expect(txMatchState({ source: "bank_match", match_status: "matched" })).toBeNull();
  });

  it("returns rematching for a bank sync movement that is locked", () => {
    expect(txMatchState({ source: "bank_sync", match_status: "rematching" })).toBe("rematching");
    expect(txMatchState({ source: "bank_sync", match_status: "matched" })).toBe("matched");
    expect(txMatchState({ source: "bank_sync", match_status: "unmatched" })).toBe("unmatched");
  });
});
