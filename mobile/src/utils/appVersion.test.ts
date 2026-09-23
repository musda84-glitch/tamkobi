import { appVersionFromConfig } from "./appVersion";

describe("appVersionFromConfig", () => {
  it("shows the marketing version and Android versionCode", () => {
    expect(appVersionFromConfig({ version: "1.0.33", android: { versionCode: 34 } })).toBe("1.0.33 (34)");
  });

  it("falls back when the config is missing", () => {
    expect(appVersionFromConfig(null)).toBe("0.0.0");
    expect(appVersionFromConfig({ version: "1.0.33" })).toBe("1.0.33");
  });
});
