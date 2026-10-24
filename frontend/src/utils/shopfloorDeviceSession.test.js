/**
 * @jest-environment jsdom
 */
import axios from "axios";
import {
  PAIRING_CODE_ALPHABET,
  SHOPFLOOR_DEVICE_TOKEN_KEY,
  attachShopfloorDeviceAuth,
  canManageShopfloorDevices,
  clearShopfloorDeviceToken,
  deviceStatusLabel,
  failedDeviceSessionTarget,
  formatDeviceSeen,
  isShopfloorDevice,
  normalizePairingCode,
  pairingQrValue,
  readShopfloorDeviceToken,
  saveShopfloorDeviceToken,
  scrubPairingCode,
  shopfloorDeviceMayOpen,
  stationModeLabel,
} from "./shopfloorDeviceSession";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("cihaz oturumu rol ve hesap tipinden anlaşılır", () => {
  expect(isShopfloorDevice(null)).toBe(false);
  expect(isShopfloorDevice({ account_type: "atolye", role: "production" })).toBe(false);
  expect(isShopfloorDevice({ account_type: "atolye_device", role: "atolye_device" })).toBe(true);
  expect(isShopfloorDevice({ account_type: "standard", role: "atolye_device" })).toBe(true);
});

test("yönetim yalnız şirket yöneticisine açıktır", () => {
  expect(canManageShopfloorDevices(null)).toBe(false);
  expect(canManageShopfloorDevices({ role: "sales" })).toBe(false);
  expect(canManageShopfloorDevices({ role: "admin", account_type: "atolye" })).toBe(true);
  expect(canManageShopfloorDevices({ role: "owner" })).toBe(true);
  expect(canManageShopfloorDevices({ role: "user", is_super_admin: true })).toBe(true);
});

test("cihaz atölye dışına çıkamaz, geçersiz oturum eşleştirmeye döner", () => {
  expect(shopfloorDeviceMayOpen("/atolye")).toBe(true);
  expect(shopfloorDeviceMayOpen("/atolye/")).toBe(true);
  expect(shopfloorDeviceMayOpen("/panel")).toBe(false);
  expect(shopfloorDeviceMayOpen("/settings")).toBe(false);
  expect(shopfloorDeviceMayOpen("/atolye-eslestir")).toBe(false);
  expect(failedDeviceSessionTarget("/panel")).toBe("/atolye-eslestir");
  expect(failedDeviceSessionTarget("/login")).toBe("");
  expect(failedDeviceSessionTarget("/atolye-eslestir")).toBe("");
});

test("kod düz altı karakterdir, adres ve QR bağlantı taşımaz", () => {
  expect(normalizePairingCode(" ab10cd ")).toBe("");
  expect(normalizePairingCode(" ab23cd ")).toBe("AB23CD");
  expect(normalizePairingCode("k4m7np")).toBe("K4M7NP");
  expect(normalizePairingCode("K4M7NP")).toBe("K4M7NP");
  expect(normalizePairingCode("https://app.tamkobi.com/atolye-eslestir?code=K4M7NP")).toBe("");
  expect(pairingQrValue("K4M7NP")).toBe("K4M7NP");
  expect(pairingQrValue("K4M7NP")).not.toContain("/");
  expect(scrubPairingCode("k4-m7 np")).toBe("K4M7NP");
  expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01IO]/);
});

test("token localStorage'da durur, kod ve adres satırına yazılmaz", () => {
  saveShopfloorDeviceToken("co.secret-token");
  expect(readShopfloorDeviceToken()).toBe("co.secret-token");
  expect(localStorage.getItem(SHOPFLOOR_DEVICE_TOKEN_KEY)).toBe("co.secret-token");
  expect(sessionStorage.length).toBe(0);
  expect(window.location.href).not.toContain("secret-token");
  expect(window.location.href).not.toContain("K4M7NP");
  clearShopfloorDeviceToken();
  expect(readShopfloorDeviceToken()).toBe("");
});

test("istek başlığına token eklenir ve ikinci kez kurulmaz", () => {
  saveShopfloorDeviceToken("co.secret-token");
  const seen = [];
  const client = {
    interceptors: {
      request: {
        use(fn) { seen.push(fn); },
      },
    },
  };
  attachShopfloorDeviceAuth(client);
  attachShopfloorDeviceAuth(client);
  expect(seen).toHaveLength(1);
  const config = seen[0]({ headers: {} });
  expect(config.headers.Authorization).toBe("Bearer co.secret-token");
  const kept = seen[0]({ headers: { Authorization: "Bearer diger" } });
  expect(kept.headers.Authorization).toBe("Bearer diger");
});

test("axios gerçek istemcisine de bir kez bağlanır", () => {
  saveShopfloorDeviceToken("co.once");
  attachShopfloorDeviceAuth(axios);
  attachShopfloorDeviceAuth(axios);
  expect(axios.__shopfloorDeviceAuth).toBe(true);
});

test("durum ve son görülme metinleri", () => {
  expect(deviceStatusLabel("active")).toBe("Aktif");
  expect(deviceStatusLabel("revoked")).toBe("İptal");
  expect(formatDeviceSeen("")).toBe("Henüz görülmedi");
  expect(formatDeviceSeen("2026-10-21T09:00:00.000Z")).toMatch(/2026/);
  expect(stationModeLabel("all", [])).toBe("Tüm istasyonlar");
  expect(stationModeLabel("one", ["CNC"])).toBe("CNC");
  expect(stationModeLabel("many", ["CNC", "Kesim"])).toBe("CNC, Kesim");
});
