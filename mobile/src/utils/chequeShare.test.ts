type PrintCall = { html?: string; width?: number; height?: number };

const printAsync = jest.fn<Promise<void>, [PrintCall]>(async () => undefined);
const printToFileAsync = jest.fn<Promise<{ uri: string }>, [PrintCall]>(async () => ({ uri: "file:///cache/out.pdf" }));
const shareAsync = jest.fn<Promise<void>, [string, { mimeType?: string; dialogTitle?: string }]>(async () => undefined);
const isAvailableAsync = jest.fn(async () => true);
const platform = { OS: "android" };

jest.mock("react-native", () => ({
  Platform: platform,
  Share: { share: jest.fn(async () => ({ action: "sharedAction" })) },
}));

jest.mock("expo-print", () => ({
  printAsync: (opts: PrintCall) => printAsync(opts),
  printToFileAsync: (opts: PrintCall) => printToFileAsync(opts),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => isAvailableAsync(),
  shareAsync: (uri: string, opts: { mimeType?: string; dialogTitle?: string }) => shareAsync(uri, opts),
}));

jest.mock("expo-file-system", () => ({
  File: class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = `file:///cache/${parts[parts.length - 1] || "file"}`;
    }
    create() { return this; }
    write() { return Promise.resolve(); }
    preview() { return Promise.resolve(); }
  },
  Paths: { cache: "file:///cache" },
}));

import { printChequeGroupReceipt, printChequeReceipt, shareChequeReceipt } from "./chequeShare";

const cheque = {
  id: "chk-aa11bb22",
  number: "CEK-2026-0009",
  serial_no: "123456",
  instrument: "cheque" as const,
  direction: "received" as const,
  status: "open",
  contact_name: "Hatice YILDIRIM",
  amount: 50,
  issue_date: "2026-09-21",
  due_date: "2026-09-21",
};

const second = {
  ...cheque,
  id: "chk-2",
  number: "SNT-2",
  serial_no: "P-99",
  instrument: "promissory" as const,
  amount: 25,
  bank_name: "Halk",
  bank_branch: "Kadıköy",
};

describe("chequeShare", () => {
  beforeEach(() => {
    platform.OS = "android";
    printAsync.mockClear();
    printToFileAsync.mockClear();
    shareAsync.mockClear();
    isAvailableAsync.mockClear().mockResolvedValue(true);
  });

  it("prints one cheque with the existing receipt and no group table", async () => {
    await expect(printChequeReceipt(cheque, { name: "Matek" }, null)).resolves.toBe(true);
    expect(printAsync).toHaveBeenCalledTimes(1);
    const html = String(printAsync.mock.calls[0][0].html || "");
    expect(html).toContain("TAHSİLAT MAKBUZU");
    expect(html).toContain("123456");
    expect(html).not.toContain("adet evrak");
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it("prints every cheque in one group document", async () => {
    await printChequeGroupReceipt({
      receipt_group_id: "grp-9",
      total: 75,
      cheques: [cheque, second],
    }, { name: "Matek" }, null);
    const html = String(printAsync.mock.calls[0][0].html || "");
    expect(html).toContain("TAHSİLAT MAKBUZU");
    expect(html).toContain("Toplam 2 adet evrak");
    expect(html).toContain("123456");
    expect(html).toContain("P-99");
    expect(html).toContain("Halk / Kadıköy");
  });

  it("shares the same receipt pdf through expo-sharing", async () => {
    await expect(shareChequeReceipt(cheque, { name: "Matek" }, null)).resolves.toBe(true);
    expect(printAsync).not.toHaveBeenCalled();
    expect(printToFileAsync).toHaveBeenCalledTimes(1);
    expect(shareAsync).toHaveBeenCalledWith("file:///cache/out.pdf", expect.objectContaining({
      mimeType: "application/pdf",
      dialogTitle: "makbuz-123456.pdf",
    }));
    const html = String(printToFileAsync.mock.calls[0][0].html || "");
    expect(html).toContain("TAHSİLAT MAKBUZU");
    expect(html).not.toContain("adet evrak");
  });
});
