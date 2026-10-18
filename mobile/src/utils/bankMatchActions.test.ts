import { post } from "../api/client";
import { emptyMatchDraft, matchPayload } from "./bankMatch";
import { submitMatch, txMatchState, unmatchTx } from "./bankMatchActions";

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
