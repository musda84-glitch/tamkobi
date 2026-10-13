const DEVICE_KEY = "tamkobi.deviceId";
const PIN_KEY = "tamkobi.punchPin";

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
  platform?: string;
  isMock?: boolean;
  isRooted?: boolean;
  punchAuth?: boolean;
}): { device_id: string; platform: string; is_mock: boolean; is_rooted: boolean; punch_auth: boolean } {
  return {
    device_id: input.deviceId,
    platform: input.platform || "",
    is_mock: Boolean(input.isMock),
    is_rooted: Boolean(input.isRooted),
    punch_auth: Boolean(input.punchAuth),
  };
}

async function storage() {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  return AsyncStorage;
}

async function pinKv() {
  try {
    const Secure = await import("expo-secure-store");
    if (Secure.getItemAsync && Secure.setItemAsync) {
      return {
        get: () => Secure.getItemAsync(PIN_KEY),
        set: (value: string) => Secure.setItemAsync(PIN_KEY, value),
      };
    }
  } catch {
    /* web / jest */
  }
  const AsyncStorage = await storage();
  return {
    get: () => AsyncStorage.getItem(PIN_KEY),
    set: (value: string) => AsyncStorage.setItem(PIN_KEY, value),
  };
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
  error?: string;
}> {
  if (!punchAuthRequired(mode)) return { ok: true, needPin: false, punchAuth: false };
  if (mode === "biometric" || mode === "either") {
    const bio = await tryBiometric();
    if (bio === true) return { ok: true, needPin: false, punchAuth: true };
    if (mode === "biometric" && bio === false) {
      return { ok: false, needPin: false, punchAuth: false, error: "Biyometrik doğrulama iptal edildi." };
    }
  }
  const stored = await readPunchPin();
  const typed = String(typedPin || "").trim();
  if (!stored) {
    if (!typed) return { ok: false, needPin: true, punchAuth: false, error: "4-6 rakamlı mesai PIN’i belirleyin." };
    const invalid = await savePunchPin(typed);
    if (invalid) return { ok: false, needPin: true, punchAuth: false, error: invalid };
    return { ok: true, needPin: false, punchAuth: true };
  }
  if (!typed) return { ok: false, needPin: true, punchAuth: false, error: "Mesai PIN’ini girin." };
  if (!pinMatches(stored, typed)) return { ok: false, needPin: true, punchAuth: false, error: "PIN hatalı." };
  return { ok: true, needPin: false, punchAuth: true };
}
