type AppConfig = {
  version?: string;
  android?: { versionCode?: number };
};

export function appVersionFromConfig(cfg?: AppConfig | null): string {
  const version = String(cfg?.version || "").trim() || "0.0.0";
  const code = Number(cfg?.android?.versionCode || 0);
  return code > 0 ? `${version} (${code})` : version;
}

export function readAppConfig(): AppConfig | null {
  try {
    const Constants = require("expo-constants").default as { expoConfig?: AppConfig };
    return Constants?.expoConfig || null;
  } catch {
    return null;
  }
}

export function appVersionLabel(): string {
  return appVersionFromConfig(readAppConfig());
}
