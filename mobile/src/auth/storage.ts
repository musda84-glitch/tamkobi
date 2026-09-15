import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_KEY, DEFAULT_API_BASE, REMEMBER_EMAIL_KEY, TOKEN_KEY, normalizeApiBase } from "../api/url";

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
  return normalizeApiBase(stored || env || DEFAULT_API_BASE);
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
