const DEVICE_KEY = "tamkobi.deviceId";
const PIN_KEY = "tamkobi.punchPin";
const DEVICE_TOKEN_KEY = "tamkobi.deviceToken";

export function punchAuthRequired(mode?: string | null): boolean {
  return mode === "pin" || mode === "biometric" || mode === "either";
}

export function validatePunchPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(String(pin || "").trim())) return "PIN 4-6 rakam olmalı.";
  return null;
}

export function pinMatches(stored: string | null | undefined, typed: string): boolean {
  const pin = String(typed || "").trim();
  return Boolean(stored) && stored === pin;
}

export function punchSecurityFields(input: {
  deviceId: string;
  deviceToken?: string;
  platform?: string;
  isMock?: boolean;
  isRooted?: boolean;
  punchAuth?: boolean;
  punchPin?: string;
}): { device_id: string; device_token: string; platform: string; is_mock: boolean; is_rooted: boolean; punch_auth: boolean; punch_pin: string } {
  return {
    device_id: input.deviceId,
    device_token: input.deviceToken || "",
    platform: input.platform || "",
    is_mock: Boolean(input.isMock),
    is_rooted: Boolean(input.isRooted),
    punch_auth: Boolean(input.punchAuth),
    punch_pin: input.punchPin || "",
  };
}

async function storage() {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  return AsyncStorage;
}

async function secretKv(key: string) {
  try {
    const Secure = await import("expo-secure-store");
    if (Secure.getItemAsync && Secure.setItemAsync) {
      return {
        get: () => Secure.getItemAsync(key),
        set: (value: string) => Secure.setItemAsync(key, value),
      };
    }
  } catch {
    /* web / jest */
  }
  const AsyncStorage = await storage();
  return {
    get: () => AsyncStorage.getItem(key),
    set: (value: string) => AsyncStorage.setItem(key, value),
  };
}

async function pinKv() {
  return secretKv(PIN_KEY);
}

async function deviceTokenKv() {
  return secretKv(DEVICE_TOKEN_KEY);
}

export async function getStableDeviceId(): Promise<string> {
  const AsyncStorage = await storage();
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const uuid = globalThis.crypto?.randomUUID?.();
  const id = uuid || `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

export async function readDeviceToken(): Promise<string> {
  return (await (await deviceTokenKv()).get()) || "";
}

export async function saveDeviceToken(token: string): Promise<void> {
  const value = String(token || "").trim();
  if (!value) return;
  await (await deviceTokenKv()).set(value);
}

export async function readPunchPin(): Promise<string | null> {
  return (await pinKv()).get();
}

export async function savePunchPin(pin: string): Promise<string | null> {
  const invalid = validatePunchPin(pin);
  if (invalid) return invalid;
  await (await pinKv()).set(pin.trim());
  return null;
}

export async function tryBiometric(): Promise<boolean | null> {
  try {
    const spec = "expo-local-authentication";
    const Local = await import(spec);
    const has = await Local.hasHardwareAsync();
    const enrolled = await Local.isEnrolledAsync();
    if (!has || !enrolled) return null;
    const res = await Local.authenticateAsync({
      promptMessage: "Mesai girişi",
      cancelLabel: "Vazgeç",
      disableDeviceFallback: true,
    });
    return Boolean(res.success);
  } catch {
    return null;
  }
}

export async function detectRooted(): Promise<boolean> {
  try {
    const Device = await import("expo-device");
    const probe = Device as { isRootedExperimentalAsync?: () => Promise<boolean>; isRooted?: boolean };
    if (typeof probe.isRootedExperimentalAsync === "function") return Boolean(await probe.isRootedExperimentalAsync());
    if (probe.isRooted === true) return true;
  } catch {
    /* modül yok */
  }
  return false;
}

export async function resolvePunchAuth(mode: string | null | undefined, typedPin: string): Promise<{
  ok: boolean;
  needPin: boolean;
  punchAuth: boolean;
  punchPin: string;
  error?: string;
}> {
  if (!punchAuthRequired(mode)) return { ok: true, needPin: false, punchAuth: false, punchPin: "" };
  if (mode === "biometric" || mode === "either") {
    const bio = await tryBiometric();
    if (bio === true) return { ok: true, needPin: false, punchAuth: true, punchPin: "" };
    if (mode === "biometric" && bio === false) {
      return { ok: false, needPin: false, punchAuth: false, punchPin: "", error: "Biyometrik doğrulama iptal edildi." };
    }
  }
  const stored = await readPunchPin();
  const typed = String(typedPin || "").trim();
  if (!typed) {
    return {
      ok: false, needPin: true, punchAuth: false, punchPin: "",
      error: stored ? "Mesai PIN’ini girin." : "4-6 rakamlı mesai PIN’i belirleyin.",
    };
  }
  const invalid = validatePunchPin(typed);
  if (invalid) return { ok: false, needPin: true, punchAuth: false, punchPin: "", error: invalid };
  if (stored && !pinMatches(stored, typed)) {
    return { ok: false, needPin: true, punchAuth: false, punchPin: "", error: "PIN hatalı." };
  }
  return { ok: true, needPin: false, punchAuth: false, punchPin: typed };
}
