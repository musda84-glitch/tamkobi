import {
  isShopfloorDevice,
  normalizePairingCode,
  requestDevicePair,
  scrubPairingCode,
  shopfloorDeviceMayOpen,
} from "./shopfloorDevice";

test("cihaz hesabı atölye e-postasından ayrıdır", () => {
  expect(isShopfloorDevice(null)).toBe(false);
  expect(isShopfloorDevice({ account_type: "atolye", role: "production" })).toBe(false);
  expect(isShopfloorDevice({ account_type: "atolye_device", role: "atolye_device" })).toBe(true);
  expect(isShopfloorDevice({ role: "atolye_device" })).toBe(true);
});

test("cihaz yalnız atölye iş ekranını açabilir", () => {
  expect(shopfloorDeviceMayOpen("/atolye")).toBe(true);
  expect(shopfloorDeviceMayOpen("/atolye/")).toBe(true);
  expect(shopfloorDeviceMayOpen("/atolye/index")).toBe(true);
  expect(shopfloorDeviceMayOpen("/")).toBe(false);
  expect(shopfloorDeviceMayOpen("/invoices")).toBe(false);
  expect(shopfloorDeviceMayOpen("/atolye-eslestir")).toBe(false);
});

test("kod düz altı karakterdir ve adres taşımaz", () => {
  expect(normalizePairingCode(" k4m7np ")).toBe("K4M7NP");
  expect(normalizePairingCode("tamkobi://atolye-eslestir?code=K4M7NP")).toBe("");
  expect(scrubPairingCode("k4-m7 np")).toBe("K4M7NP");
});

test("eşleştirme isteği kodu gövdede yollar, token döner, loglamaz", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const postFn = jest.fn(async () => ({ token: "co.device-secret" }));
  const token = await requestDevicePair(postFn, "k4m7np");
  expect(token).toBe("co.device-secret");
  expect(postFn).toHaveBeenCalledWith("/shopfloor/devices/pair", { code: "K4M7NP" });
  expect(JSON.stringify(log.mock.calls)).not.toContain("K4M7NP");
  expect(JSON.stringify(log.mock.calls)).not.toContain("device-secret");
  log.mockRestore();
  await expect(requestDevicePair(postFn, "https://x/k4m7np")).rejects.toThrow("6 karakter");
});
