import { Platform } from "react-native";

export type PickedB2bFile = { name: string; type: string; file: Blob; uri?: string };

const ACCEPT = ".xlsx,.xlsm,.csv,.pdf,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf";

/** Web'de gizli input; native'de expo-document-picker (yoksa hata). */
export async function pickB2bListFile(): Promise<PickedB2bFile | null> {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ACCEPT;
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, type: f.type || "application/octet-stream", file: f } : null);
      };
      input.click();
    });
  }
  try {
    const picker = await import("expo-document-picker");
    const res = await picker.getDocumentAsync({
      type: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
        "text/csv",
        "text/plain",
        "application/pdf",
        "*/*",
      ],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    const blob = await fetch(a.uri).then((r) => r.blob());
    return { name: a.name || "siparis.xlsx", type: a.mimeType || blob.type || "application/octet-stream", file: blob, uri: a.uri };
  } catch {
    throw new Error("Dosya seçici bu derlemede yok. Excel’i web portalından yükleyebilirsiniz.");
  }
}

export function appendPickedFile(form: FormData, picked: PickedB2bFile) {
  if (Platform.OS === "web") {
    form.append("file", picked.file, picked.name);
    return;
  }
  form.append("file", { uri: picked.uri, name: picked.name, type: picked.type } as unknown as Blob);
}
