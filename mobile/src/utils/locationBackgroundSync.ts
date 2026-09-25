import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { loadToken } from "../auth/storage";
import {
  LOCATION_BG_STORE_KEY,
  LOCATION_BG_TASK,
  locationBgUpdatesOptions,
  parseLocationBgConfig,
  serializeLocationBgConfig,
  shouldRunLocationBackground,
  type LocationBgConfig,
} from "./locationBackground";

export async function loadLocationBgConfig(): Promise<LocationBgConfig | null> {
  try {
    return parseLocationBgConfig(await AsyncStorage.getItem(LOCATION_BG_STORE_KEY));
  } catch {
    return null;
  }
}

export async function saveLocationBgConfig(cfg: LocationBgConfig): Promise<void> {
  await AsyncStorage.setItem(LOCATION_BG_STORE_KEY, serializeLocationBgConfig(cfg));
}

export async function clearLocationBgConfig(): Promise<void> {
  await AsyncStorage.removeItem(LOCATION_BG_STORE_KEY);
}

async function nativeLocation() {
  return import("expo-location");
}

export async function stopLocationBackground(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Location = await nativeLocation();
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_BG_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_BG_TASK);
  } catch {
    /* web / Expo Go / task yok */
  }
}

export async function syncLocationBackground(input: {
  consented: boolean;
  enabled: boolean;
  continuous?: boolean;
  interval_minutes?: number;
  checkedOut?: boolean;
}): Promise<"started" | "stopped" | "skipped"> {
  const cfg: LocationBgConfig = {
    enabled: Boolean(input.enabled),
    consented: Boolean(input.consented),
    continuous: Boolean(input.continuous) || Number(input.interval_minutes) === 0,
    interval_minutes: Number(input.interval_minutes) || 0,
    checkedOut: Boolean(input.checkedOut),
  };
  try {
    await saveLocationBgConfig(cfg);
  } catch {
    /* kota */
  }
  if (Platform.OS === "web") return "skipped";
  const token = await loadToken();
  if (!shouldRunLocationBackground({ ...cfg, token, platform: Platform.OS })) {
    await stopLocationBackground();
    return "stopped";
  }
  try {
    const Location = await nativeLocation();
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      await stopLocationBackground();
      return "stopped";
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") {
      await stopLocationBackground();
      return "stopped";
    }
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_BG_TASK).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_BG_TASK).catch(() => undefined);
    await Location.startLocationUpdatesAsync(LOCATION_BG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      ...locationBgUpdatesOptions(cfg),
    });
    return "started";
  } catch {
    return "skipped";
  }
}

export async function resumeLocationBackground(): Promise<"started" | "stopped" | "skipped"> {
  const cfg = await loadLocationBgConfig();
  if (!cfg) return "stopped";
  return syncLocationBackground(cfg);
}

export async function haltLocationBackground(): Promise<void> {
  await clearLocationBgConfig();
  await stopLocationBackground();
}
