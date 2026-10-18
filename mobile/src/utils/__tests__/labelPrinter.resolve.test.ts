import AsyncStorage from "@react-native-async-storage/async-storage";
import { get } from "../../api/client";
import { LABEL_PRINTER_KEY, resolveLabelPrinter } from "../labelPrinter";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  put: jest.fn(),
}));

const client = { baseUrl: "https://api.test", token: "tok" };
const companyId = "co-1";

function storage() {
  return AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };
}

describe("resolveLabelPrinter", () => {
  beforeEach(() => {
    storage().getItem.mockReset();
    storage().setItem.mockReset();
    (get as unknown as jest.Mock).mockReset();
    storage().getItem.mockResolvedValue(null);
    storage().setItem.mockResolvedValue(undefined);
  });

  it("uses the phone settings and does not call the company API when a host is saved", async () => {
    storage().getItem.mockResolvedValue(JSON.stringify({
      name: "Depo",
      host: "10.0.0.5",
      port: 9100,
      widthMm: 100,
      heightMm: 50,
      gapMm: 2,
      dpi: 203,
      textMode: "codepage",
    }));
    const resolved = await resolveLabelPrinter(client, companyId);
    expect(resolved.source).toBe("device");
    expect(resolved.host).toBe("10.0.0.5");
    expect(resolved.port).toBe(9100);
    expect(get).not.toHaveBeenCalled();
    expect(storage().setItem).not.toHaveBeenCalled();
  });

  it("caches the company default on this phone when the device host is empty", async () => {
    (get as unknown as jest.Mock).mockResolvedValue({
      configured: true,
      name: "Şirket",
      host: "192.168.1.117",
      port: 9100,
      width_mm: 100,
      height_mm: 40,
      gap_mm: 2,
      dpi: 203,
      text_mode: "codepage",
    });
    const resolved = await resolveLabelPrinter(client, companyId);
    expect(resolved.source).toBe("company");
    expect(resolved.host).toBe("192.168.1.117");
    expect(get).toHaveBeenCalledWith(client, `/companies/${companyId}/label-printer`);
    expect(storage().setItem).toHaveBeenCalled();
    const [key, raw] = storage().setItem.mock.calls[0];
    expect(key).toBe(`${LABEL_PRINTER_KEY}:${companyId}`);
    expect(JSON.parse(raw).host).toBe("192.168.1.117");
  });

  it("returns none with the default printer when neither side has a host", async () => {
    (get as unknown as jest.Mock).mockResolvedValue({ configured: false, host: "" });
    const resolved = await resolveLabelPrinter(client, companyId);
    expect(resolved.source).toBe("none");
    expect(resolved.host).toBe("");
    expect(resolved.port).toBe(9100);
    expect(storage().setItem).not.toHaveBeenCalled();
  });

  it("returns none without throwing when the company printer request fails", async () => {
    (get as unknown as jest.Mock).mockRejectedValue(new Error("network down"));
    await expect(resolveLabelPrinter(client, companyId)).resolves.toMatchObject({
      source: "none",
      host: "",
      port: 9100,
    });
    expect(storage().setItem).not.toHaveBeenCalled();
  });
});
