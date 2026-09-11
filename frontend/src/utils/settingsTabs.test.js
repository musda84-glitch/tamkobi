import { readSettingsTab, writeSettingsTab, settingsParamFor, DEFAULT_SETTINGS_TAB } from "./settingsTabs";

describe("ayar bölümünü adresten okuma", () => {
  test("kendi adresinde ?tab= okunur", () => {
    expect(readSettingsTab("?tab=einvoice")).toBe("einvoice");
  });

  test("gömülü hâlde Hesabım'ın ?tab=ayarlar değeri bölüm sanılmaz", () => {
    expect(readSettingsTab("?tab=ayarlar", true)).toBe(DEFAULT_SETTINGS_TAB);
  });

  test("gömülü hâlde bölüm ?ayar= içinden gelir", () => {
    expect(readSettingsTab("?tab=ayarlar&ayar=users", true)).toBe("users");
  });

  test("parametre yoksa Şirket Bilgileri açılır", () => {
    expect(readSettingsTab("", false)).toBe(DEFAULT_SETTINGS_TAB);
    expect(readSettingsTab("", true)).toBe(DEFAULT_SETTINGS_TAB);
  });
});

describe("bölüm değiştirme", () => {
  test("gömülü hâlde tab=ayarlar korunur", () => {
    const next = writeSettingsTab("?tab=ayarlar", true, "print");
    expect(next.get("tab")).toBe("ayarlar");
    expect(next.get("ayar")).toBe("print");
  });

  test("kendi adresinde tab'ın kendisi değişir", () => {
    const next = writeSettingsTab("?tab=company", false, "bank");
    expect(next.get("tab")).toBe("bank");
    expect(next.get("ayar")).toBeNull();
  });

  test("ilgisiz parametreler taşınır", () => {
    const next = writeSettingsTab("?tab=ayarlar&company_id=comp_1", true, "fx");
    expect(next.get("company_id")).toBe("comp_1");
  });

  test("yazılan değer aynı kipte geri okunur", () => {
    for (const embedded of [false, true]) {
      const next = writeSettingsTab("?tab=ayarlar", embedded, "migration");
      expect(readSettingsTab(`?${next}`, embedded)).toBe("migration");
    }
  });

  // Sayfa react-router'ın URLSearchParams nesnesini doğrudan veriyor.
  test("URLSearchParams nesnesi de kabul edilir", () => {
    const params = new URLSearchParams("tab=ayarlar&ayar=sms");
    expect(readSettingsTab(params, true)).toBe("sms");
    expect(writeSettingsTab(params, true, "bank").get("tab")).toBe("ayarlar");
  });
});

test("iki kip ayrı parametre kullanır", () => {
  expect(settingsParamFor(false)).not.toBe(settingsParamFor(true));
});
