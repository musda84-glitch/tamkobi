import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const policy = createRequire(import.meta.url)("./policy.js");

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test("mod yönlendirmeleri kayıtlı seçimi ve yetkisiz modları ayırır", () => {
  assert.equal(policy.modeUrl("atolye"), "https://app.tamkobi.com/atolye");
  assert.equal(policy.modeUrl("sevk"), "https://app.tamkobi.com/sevk");
  assert.equal(policy.modeUrl("sayim"), "https://app.tamkobi.com/sayim");
  assert.equal(policy.modeUrl("hizli-satis"), "https://app.tamkobi.com/hizli-satis");
  assert.equal(policy.modeById("hizli-satis").cashier, true);
  assert.equal(policy.modeUrl("ayarlar"), null);
  assert.equal(policy.modeUrl("atolye", "https://evil.example"), null);

  const sales = {
    role: "sales",
    permissions: {
      "/atolye": "none",
      "/sevk": "view",
      "/sayim": "none",
      "/hizli-satis": "edit",
    },
  };
  const salesModes = policy.visibleModes(sales, { modules: {} }).map((mode) => mode.id);
  assert.deepEqual(salesModes, ["sevk", "hizli-satis"]);

  const warehouse = {
    role: "warehouse",
    permissions: {
      "/atolye": "view",
      "/sevk": "edit",
      "/sayim": "edit",
      "/hizli-satis": "none",
    },
  };
  assert.deepEqual(
    policy.visibleModes(warehouse, null).map((mode) => mode.id),
    ["atolye", "sevk", "sayim"],
  );

  const personel = {
    role: "personel",
    permissions: { "/atolye": "edit", "/sevk": "none", "/sayim": "none", "/hizli-satis": "none" },
  };
  assert.deepEqual(policy.visibleModes(personel, null).map((mode) => mode.id), ["atolye"]);

  const accountant = {
    role: "accountant",
    permissions: { "/atolye": "none", "/sevk": "none", "/sayim": "none", "/hizli-satis": "none" },
  };
  assert.deepEqual(policy.visibleModes(accountant, null), []);
  assert.deepEqual(policy.visibleModes(null, null), []);
  assert.deepEqual(policy.visibleModes({ role: "sales" }, null), []);

  const admin = policy.visibleModes({ role: "owner" }, {
    modules: { "/sayim": false, "/atolye": true, "/sevk": true, "/hizli-satis": true },
  }).map((mode) => mode.id);
  assert.deepEqual(admin, ["atolye", "sevk", "hizli-satis"]);

  const storage = memoryStorage();
  assert.equal(policy.rememberMode(storage, "sevk"), true);
  assert.equal(policy.rememberedMode(storage), "sevk");
  assert.equal(policy.rememberMode(storage, "yok"), false);
  const picked = policy.startupSelection("sevk", sales, null);
  assert.equal(picked.selected, "sevk");
  assert.equal(policy.startupSelection("atolye", sales, null).selected, null);
  assert.equal(policy.startupSelection("sayim", warehouse, { modules: { "/sayim": false } }).selected, null);
});

test("alan adı kısıtı yalnız tamkobi kabuğunu içeri alır", () => {
  const allow = [
    "https://app.tamkobi.com/atolye",
    "https://app.tamkobi.com/hizli-satis?kiosk=1",
    "https://b2b.tamkobi.com/siparis",
    "https://ik.tamkobi.com/",
    "https://tamkobi.com/",
    "https://www.tamkobi.com/panel",
    "http://tauri.localhost/index.html",
    "https://tauri.localhost/kiosk-exit.html",
    "tauri://localhost/index.html",
    "http://ipc.localhost/command",
    "asset://localhost/icon.png",
    "blob:https://app.tamkobi.com/00000000-0000-0000-0000-000000000000",
    "data:text/html,merhaba",
    "about:blank",
  ];
  for (const url of allow) {
    assert.equal(policy.classifyNavigation(url, { dev: false }), "allow", url);
  }

  assert.equal(policy.classifyNavigation("https://app.tamkobi.com.evil.com/"), "external");
  assert.equal(policy.classifyNavigation("https://eviltamkobi.com/"), "external");
  assert.equal(policy.classifyNavigation("https://example.com/"), "external");
  assert.equal(policy.classifyNavigation("http://app.tamkobi.com/login"), "external");
  assert.equal(policy.classifyNavigation("http://127.0.0.1:1420/"), "deny");
  assert.equal(policy.classifyNavigation("http://127.0.0.1:1420/", { dev: true }), "allow");
  assert.equal(policy.classifyNavigation("javascript:alert(1)"), "deny");
  assert.equal(policy.classifyNavigation("file:///etc/passwd"), "deny");
  assert.equal(policy.classifyNavigation("not a url"), "deny");
  assert.equal(policy.isTamkobiUrl("https://app.tamkobi.com/sevk"), true);
  assert.equal(policy.isTamkobiUrl("http://tauri.localhost/"), false);
});

test("kiosk çıkış PIN'i kasiyer kilidi ile aynı kapıyı kullanır", () => {
  const sales = { id: "u_sales", role: "sales", rules: policy.defaultPosRules("sales") };
  const admin = { id: "u_admin", role: "admin", rules: { can_approve: false } };
  const blocked = {
    cashier_user_id: "u_sales",
    exit_granted: false,
    rules: policy.defaultPosRules("sales"),
  };

  assert.equal(policy.kioskExitDecision({ pin: "123", approver: admin }).detail, "PIN 4-6 haneli rakam olmalı.");
  assert.equal(policy.kioskExitDecision({ pin: "12ab", approver: admin }).allow, false);
  assert.equal(policy.kioskExitDecision({ pin: "1234567", approver: admin }).allow, false);
  assert.equal(policy.kioskExitDecision({ pin: "1234", approver: { role: "admin" } }).detail, "Kullanıcı seçin.");
  assert.equal(
    policy.kioskExitDecision({ pin: "1234", approver: sales }).detail,
    "Bu PIN yönetici onayı veremez.",
  );
  assert.equal(policy.kioskExitDecision({ pin: "1234", approver: admin }).allow, true);
  assert.equal(
    policy.kioskExitDecision({ pin: " 123456 ", approver: { id: "u_mgr", role: "manager", rules: {} } }).allow,
    true,
  );
  assert.equal(
    policy.kioskExitDecision({
      pin: "1234",
      approver: { id: "u_lead", role: "sales", rules: { can_approve: true } },
    }).allow,
    true,
  );
  assert.equal(
    policy.kioskExitDecision({
      pin: "1234",
      approver: { id: "u_sales", role: "admin" },
      session: blocked,
    }).detail,
    "Talebi açan kasiyer bu talebi onaylayamaz.",
  );
  // admin id differs from the cashier, so the supervisor can leave.
  assert.equal(
    policy.kioskExitDecision({
      pin: "1234",
      approver: { id: "u_admin", role: "admin" },
      session: blocked,
    }).allow,
    true,
  );
  assert.equal(policy.isKioskExitChord({ key: "l", ctrlKey: true, shiftKey: true }), true);
  assert.equal(policy.isKioskExitChord({ key: "Enter", ctrlKey: false, shiftKey: false }), false);
  assert.equal(policy.isKioskExitChord({ key: "5" }), false);
  const granted = policy.kioskExitDecision({ pin: "1234", approver: admin });
  assert.equal(Object.hasOwn(granted, "nonce"), false);
  assert.equal(typeof granted.allow, "boolean");
});

test("uzak kabuk komutları yalnız app.tamkobi.com adresine açıktır", () => {
  const remote = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/remote.json", import.meta.url), "utf8"));
  assert.deepEqual(remote.remote.urls, ["https://app.tamkobi.com/*"]);
  for (const url of remote.remote.urls) {
    assert.equal(url.includes("*."), false);
    assert.equal(policy.classifyNavigation(url.replace("*", "atolye"), { dev: false }), "allow");
  }
});

test("kiosk çıkış nonce'u sayfaya verilmez; isteği kabuk yapar", () => {
  const inject = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src-tauri/src/shell.rs", import.meta.url), "utf8");
  assert.equal(inject.includes("nonce"), false);
  assert.equal(inject.includes("/api/desktop/kiosk-exit"), false);
  assert.match(inject, /complete_kiosk_exit/);
  assert.match(inject, /approverId/);
  assert.match(shell, /window\.__tamkobiShowKioskExit&&window\.__tamkobiShowKioskExit\(\)/);
  assert.doesNotMatch(shell, /__tamkobiShowKioskExit\(\{[^)]*\}\)/);
  assert.match(shell, /https:\/\/app\.tamkobi\.com\/api\/desktop\/kiosk-exit/);
  assert.match(shell, /access_token/);
  assert.match(shell, /parsed\.get\("allow"\)/);
});

test("updater pubkey yer tutucusu README'de signer generate ile değiştirilir", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const pubkey = conf.plugins.updater.pubkey;
  assert.equal(typeof pubkey, "string");
  assert.ok(pubkey.length > 20);
  assert.match(readme, /Uyarı — updater pubkey/);
  assert.match(readme, /signer generate/);
  assert.match(readme, /plugins\.updater\.pubkey/);
  assert.ok(readme.includes(pubkey));
  assert.match(readme, /tamkobi\.key/);
});
