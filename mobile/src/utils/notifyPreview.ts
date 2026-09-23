import { Platform } from "react-native";
import { appVersionLabel } from "./appVersion";
import { playTamkobiNotify, unlockTamkobiNotify } from "./notifySound";
import { presentLocalNotification } from "./pushRegister";

/** Girişte TamKobi çanını hemen çalar — web Audio, telefonda bildirim kanalı. */
export async function previewTamkobiNotify(): Promise<boolean> {
  if (Platform.OS === "web") {
    unlockTamkobiNotify();
    return playTamkobiNotify();
  }
  return presentLocalNotification({
    title: "TamKobi",
    body: `Bildirim sesi ${appVersionLabel()}`,
  });
}
