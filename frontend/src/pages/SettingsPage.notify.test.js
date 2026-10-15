const fs = require("fs");
const path = require("path");

test("firma ayarlarında Bildirimler sekmesi yok", () => {
  const src = fs.readFileSync(path.join(__dirname, "SettingsPage.jsx"), "utf8");
  expect(src).not.toMatch(/\["notifications", "Bildirimler"/);
  expect(src).not.toMatch(/shownTab === "notifications"/);
  expect(src).not.toMatch(/NotifyPrefsPanel/);
  expect(src).toMatch(/\["company", "Şirket Bilgileri"/);
});
