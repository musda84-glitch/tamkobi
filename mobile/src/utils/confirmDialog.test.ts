import { bindConfirmHost, requestConfirm } from "./confirmDialog";

describe("requestConfirm", () => {
  afterEach(() => bindConfirmHost(null));

  it("waits for the in-app host instead of deleting immediately", async () => {
    let seen = "";
    bindConfirmHost((ask) => {
      if (!ask) return;
      seen = `${ask.title}|${ask.confirmLabel}|${ask.message}`;
      ask.resolve(false);
    });
    await expect(requestConfirm("Hareketi sil", "Tahsilat silinsin mi?", "Sil")).resolves.toBe(false);
    expect(seen).toBe("Hareketi sil|Sil|Tahsilat silinsin mi?");
  });

  it("only proceeds when the host confirms", async () => {
    bindConfirmHost((ask) => ask?.resolve(true));
    await expect(requestConfirm("Sil", "Emin misiniz?", "Sil")).resolves.toBe(true);
  });
});
