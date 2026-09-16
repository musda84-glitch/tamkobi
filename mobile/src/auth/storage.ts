import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  API_BASE_KEY,
  B2B_NAME_KEY,
  B2B_TOKEN_KEY,
  DEFAULT_API_BASE,
  extraApiUrl,
  REMEMBER_B2B_EMAIL_KEY,
  REMEMBER_EMAIL_KEY,
  SESSION_KIND_KEY,
  TOKEN_KEY,
  normalizeApiBase,
} from "../api/url";
import type { SessionKind } from "../types";

function readExpoExtra(): { apiUrl?: unknown } | undefined {
  try {
    const Constants = require("expo-constants").default as { expoConfig?: { extra?: { apiUrl?: unknown } } };
    return Constants?.expoConfig?.extra;
  } catch {
    return undefined;
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    const SecureStore = await import("expo-secure-store");
    if (SecureStore?.getItemAsync) return await SecureStore.getItemAsync(key);
  } catch {
    /* web / tests */
  }
  return AsyncStorage.getItem(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store");
    if (SecureStore?.setItemAsync) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
  } catch {
    /* web / tests */
  }
  await AsyncStorage.setItem(key, value);
}

async function secureDel(key: string): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store");
    if (SecureStore?.deleteItemAsync) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
  } catch {
    /* web / tests */
  }
  await AsyncStorage.removeItem(key);
}

export async function loadApiBase(): Promise<string> {
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  const env = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_URL : undefined;
  return normalizeApiBase(stored || env || extraApiUrl(readExpoExtra()) || DEFAULT_API_BASE);
}

export async function saveApiBase(value: string): Promise<string> {
  const next = normalizeApiBase(value);
  await AsyncStorage.setItem(API_BASE_KEY, next);
  return next;
}

export async function loadToken(): Promise<string | null> {
  return secureGet(TOKEN_KEY);
}

export async function saveToken(token: string): Promise<void> {
  await secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await secureDel(TOKEN_KEY);
}

export async function loadRememberedEmail(): Promise<string> {
  return (await AsyncStorage.getItem(REMEMBER_EMAIL_KEY)) || "";
}

export async function saveRememberedEmail(email: string | null): Promise<void> {
  if (email) await AsyncStorage.setItem(REMEMBER_EMAIL_KEY, email);
  else await AsyncStorage.removeItem(REMEMBER_EMAIL_KEY);
}

export async function loadSessionKind(): Promise<SessionKind | null> {
  const v = await AsyncStorage.getItem(SESSION_KIND_KEY);
  return v === "erp" || v === "b2b" ? v : null;
}

export async function saveSessionKind(kind: SessionKind | null): Promise<void> {
  if (kind) await AsyncStorage.setItem(SESSION_KIND_KEY, kind);
  else await AsyncStorage.removeItem(SESSION_KIND_KEY);
}

export async function loadB2bToken(): Promise<string | null> {
  return secureGet(B2B_TOKEN_KEY);
}

export async function saveB2bToken(token: string): Promise<void> {
  await secureSet(B2B_TOKEN_KEY, token);
}

export async function loadB2bName(): Promise<string> {
  return (await AsyncStorage.getItem(B2B_NAME_KEY)) || "";
}

export async function saveB2bName(name: string | null): Promise<void> {
  if (name) await AsyncStorage.setItem(B2B_NAME_KEY, name);
  else await AsyncStorage.removeItem(B2B_NAME_KEY);
}

export async function clearB2bSession(): Promise<void> {
  await secureDel(B2B_TOKEN_KEY);
  await AsyncStorage.removeItem(B2B_NAME_KEY);
}

export async function loadRememberedB2bEmail(): Promise<string> {
  return (await AsyncStorage.getItem(REMEMBER_B2B_EMAIL_KEY)) || "";
}

export async function saveRememberedB2bEmail(email: string | null): Promise<void> {
  if (email) await AsyncStorage.setItem(REMEMBER_B2B_EMAIL_KEY, email);
  else await AsyncStorage.removeItem(REMEMBER_B2B_EMAIL_KEY);
}
