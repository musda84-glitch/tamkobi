/**
 * @jest-environment jsdom
 */
const fs = require("fs");
const path = require("path");

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
require("fake-indexeddb/auto");

const { openOfflineDb } = require("../offline/db");
const {
  LOGOUT_STAMP_KEY,
  clearBrowserAuthStorage,
  isAuthStorageKey,
  isPreservedLocalKey,
  logoutEverywhere,
  subscribeLogout,
} = require("./sessionLogout");

function makeDb(name) {
  return openOfflineDb(name);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.confirm = jest.fn(() => true);
});

test("oturum anahtarları silinir, cihaz oturumu ve sepet kalır", async () => {
  localStorage.setItem("tamkobi_remember_email", "ada@example.com");
  localStorage.setItem("tamkobi.deviceToken", "punch-token");
  localStorage.setItem("tamkobi.punchPin", "1234");
  localStorage.setItem("b2b_contact_portals", "{\"c\":\"tok\"}");
  localStorage.setItem("tamkobi.shopfloorDeviceToken", "co.device");
  localStorage.setItem("tamkobi.deviceId", "device-1");
  localStorage.setItem("b2b_cart_tok-a", "{\"p1\":1}");
  localStorage.setItem("sidebar_collapsed", "1");
  sessionStorage.setItem("b2b_session", "select-secret");
  sessionStorage.setItem("nx_sf_op:co:usr", JSON.stringify({ token: "op-token" }));

  const db = makeDb(`logout-${Date.now()}`);
  await db.products.put({ companyId: "co", id: "p1", name: "Kalem" });
  const navigate = jest.fn();
  const request = jest.fn().mockResolvedValue({ data: { status: "success" } });
  const result = await logoutEverywhere({
    apiUrl: "/api",
    to: "/login",
    request,
    navigate,
    db,
    confirm: () => true,
    readB2BSession: () => "select-secret",
  });

  expect(result.ok).toBe(true);
  expect(request).toHaveBeenCalledWith("/api/auth/logout", {});
  expect(request).toHaveBeenCalledWith(
    "/api/public/b2b/logout",
    { select_token: "select-secret" },
    { headers: { Authorization: "B2BSession select-secret" } },
  );
  expect(localStorage.getItem("tamkobi_remember_email")).toBeNull();
  expect(localStorage.getItem("tamkobi.deviceToken")).toBeNull();
  expect(localStorage.getItem("tamkobi.punchPin")).toBeNull();
  expect(localStorage.getItem("b2b_contact_portals")).toBeNull();
  expect(localStorage.getItem("tamkobi.shopfloorDeviceToken")).toBe("co.device");
  expect(localStorage.getItem("tamkobi.deviceId")).toBe("device-1");
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("sidebar_collapsed")).toBe("1");
  expect(sessionStorage.length).toBe(0);
  expect(await db.products.count()).toBe(0);
  expect(navigate).toHaveBeenCalledWith("/login");
  expect(isPreservedLocalKey("tamkobi.shopfloorDeviceToken")).toBe(true);
  expect(isAuthStorageKey("tamkobi.deviceToken")).toBe(true);
  expect(isAuthStorageKey("nx_sf_op:co:usr")).toBe(true);
  const stamp = JSON.parse(localStorage.getItem(LOGOUT_STAMP_KEY));
  expect(stamp.type).toBe("logout");
  expect(stamp.dropQueue).toBe(true);
});

test("bekleyen kuyruk onaylanmadan silinmez ve çıkış iptal olur", async () => {
  const db = makeDb(`logout-queue-${Date.now()}`);
  await db.queue.add({ status: "pending", url: "/api/orders", body: { qty: 1 } });
  const request = jest.fn();
  const result = await logoutEverywhere({
    to: "/login",
    request,
    navigate: jest.fn(),
    db,
    confirm: () => false,
  });
  expect(result.ok).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await db.queue.where("status").equals("pending").count()).toBe(1);
});

test("onaylanan kuyruk silinir", async () => {
  const db = makeDb(`logout-drop-${Date.now()}`);
  await db.queue.add({ status: "pending", url: "/api/orders", body: { qty: 2 } });
  const result = await logoutEverywhere({
    to: "",
    request: jest.fn().mockResolvedValue({}),
    db,
    confirm: (message) => message.includes("bekleyen"),
  });
  expect(result.ok).toBe(true);
  expect(result.dropQueue).toBe(true);
  expect(await db.queue.count()).toBe(0);
});

test("diğer sekme storage olayı çıkışı görür", () => {
  const seen = [];
  const stop = subscribeLogout((payload) => seen.push(payload));
  window.dispatchEvent(new StorageEvent("storage", {
    key: LOGOUT_STAMP_KEY,
    newValue: JSON.stringify({ type: "logout", dropQueue: false, to: "/b2b/giris" }),
  }));
  expect(seen).toEqual([{ type: "logout", dropQueue: false, to: "/b2b/giris" }]);
  stop();
});

test("oturumlu API önbelleği silinir, statik önbellek kalır", async () => {
  const deleted = [];
  const cacheStore = {
    keys: async () => ["tamkobi-api", "tamkobi-html", "tamkobi-static"],
    delete: async (name) => { deleted.push(name); return true; },
  };
  await logoutEverywhere({
    to: "",
    request: async () => {},
    db: null,
    caches: cacheStore,
    confirm: () => true,
  });
  expect(deleted.sort()).toEqual(["tamkobi-api", "tamkobi-html"]);
});

test("giriş formu kendiliğinden gönderilmez, beni hatırla kapalıdır", () => {
  const login = fs.readFileSync(path.join(__dirname, "../pages/LoginPage.jsx"), "utf8");
  const auth = fs.readFileSync(path.join(__dirname, "../context/AuthContext.jsx"), "utf8");
  const b2b = fs.readFileSync(path.join(__dirname, "../utils/b2bSession.js"), "utf8");
  expect(login).toMatch(/useState\(false\)/);
  expect(login).toMatch(/autoComplete="current-password"/);
  expect(login).not.toMatch(/requestSubmit|\.submit\(\)/);
  expect(login).not.toMatch(/useEffect\(\(\) => \{\s*login\(/);
  expect(auth).toMatch(/logoutEverywhere/);
  expect(b2b).toMatch(/logoutEverywhere/);
  clearBrowserAuthStorage();
});
