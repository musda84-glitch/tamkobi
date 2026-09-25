import * as TaskManager from "expo-task-manager";
import { post } from "./api/client";
import { loadApiBase, loadToken } from "./auth/storage";
import { LOCATION_BG_TASK, locationFromTaskData, shouldRunLocationBackground } from "./utils/locationBackground";
import { loadLocationBgConfig } from "./utils/locationBackgroundSync";

/** Uygulama kapalıyken de konum ping’i — TaskManager global tanımlı olmalı. */
try {
  TaskManager.defineTask(LOCATION_BG_TASK, async ({ data, error }) => {
    if (error) return;
    const coords = locationFromTaskData(data);
    if (!coords) return;
    try {
      const token = await loadToken();
      const baseUrl = await loadApiBase();
      const cfg = await loadLocationBgConfig();
      if (!shouldRunLocationBackground({
        consented: cfg?.consented,
        enabled: cfg?.enabled,
        checkedOut: cfg?.checkedOut,
        token,
      })) return;
      await post({ baseUrl, token }, "/personnel/attendance/self/location", {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: coords.accuracy_m,
      });
    } catch {
      /* ağ yoksa bir sonraki ping dener */
    }
  });
} catch {
  /* web / Expo Go */
}
