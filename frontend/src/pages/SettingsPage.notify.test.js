const fs = require("fs");
const path = require("path");

test("firma ayarlarında Bildirimler sekmesi firma aç/kapa panelini gösterir", () => {
  const src = fs.readFileSync(path.join(__dirname, "SettingsPage.jsx"), "utf8");
  expect(src).toMatch(/\["notifications", "Bildirimler"/);
  expect(src).toMatch(/shownTab === "notifications"/);
  expect(src).toMatch(/TenantNotifyPanel/);
  expect(src).not.toMatch(/NotifyPrefsPanel/);
  expect(src).toMatch(/\["company", "Şirket Bilgileri"/);
});
