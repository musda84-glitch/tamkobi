/** Expo SDK 58 winter fetch Blob / {bytes()} kabul eder; {uri,name,type} Unsupported FormDataPart atar. */

export type ImageEntity = "survey" | "project" | "quote" | "product" | "partner" | "employee";

export type PickerAssetLike = {
  uri?: string;
  fileName?: string | null;
  mimeType?: string | null;
  file?: Blob;
};

function fileToPickerAsset(f: File): PickerAssetLike {
  let uri = "";
  try {
    uri = typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(f) : "";
  } catch {
    uri = "";
  }
  return {
    uri,
    file: f,
    fileName: f.name,
    mimeType: f.type || "image/jpeg",
  };
}

/** Web Glass / RNW: expo-image-picker izni takılabiliyor; gizli file input kullan. */
export function pickBrowserImages(
  createInput: () => HTMLInputElement | null = () => (typeof document !== "undefined" ? document.createElement("input") : null),
  multiple = true,
): Promise<PickerAssetLike[]> {
  const input = createInput();
  if (!input) return Promise.resolve([]);
  return new Promise((resolve) => {
    input.type = "file";
    input.accept = "image/*";
    input.multiple = multiple;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files.map(fileToPickerAsset));
    };
    input.click();
  });
}

export async function pickBrowserImage(
  createInput: () => HTMLInputElement | null = () => (typeof document !== "undefined" ? document.createElement("input") : null),
): Promise<PickerAssetLike | null> {
  const rows = await pickBrowserImages(createInput, false);
  return rows[0] || null;
}

/** Web Glass: kamera capture veya galeri/PDF. Native ImagePicker ayrı. */
export function pickBrowserReceipt(
  mode: "camera" | "gallery" = "gallery",
  createInput: () => HTMLInputElement | null = () => (typeof document !== "undefined" ? document.createElement("input") : null),
): Promise<PickerAssetLike | null> {
  const input = createInput();
  if (!input) return Promise.resolve(null);
  return new Promise((resolve) => {
    input.type = "file";
    input.accept = mode === "gallery" ? "image/*,application/pdf" : "image/*";
    input.multiple = false;
    if (mode === "camera") {
      try { input.setAttribute("capture", "environment"); } catch { /* jsdom */ }
    }
    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files[0] ? fileToPickerAsset(files[0]) : null);
    };
    input.click();
  });
}

export function pickerFileMeta(asset: PickerAssetLike, fallbackName = "photo.jpg") {
  const name = (asset.fileName || "").trim() || fallbackName;
  const type = (asset.mimeType || "").trim() || "image/jpeg";
  const uri = (asset.uri || "").trim();
  return { name, type, uri };
}

/** Expo convertFormDataAsync: string | Blob | {bytes()}. uri parçası hata. */
export function isExpoFetchFilePart(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;
  const o = value as { bytes?: unknown; arrayBuffer?: unknown };
  if (typeof o.bytes === "function") return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return typeof o.arrayBuffer === "function";
}

export function appendUploadBlob(form: FormData, blob: Blob, name: string, field = "file"): void {
  form.append(field, blob, name);
}

export async function readLocalImageBlob(uri: string): Promise<Blob> {
  try {
    const mod = await import("expo-file-system");
    if (mod.File) return new mod.File(uri) as unknown as Blob;
  } catch {
    /* web / test */
  }
  const res = await fetch(uri);
  if (!res.ok) throw new Error("Fotoğraf okunamadı.");
  return res.blob();
}

export async function resolveUploadBlob(
  asset: PickerAssetLike,
  readFile: (uri: string) => Promise<Blob> = readLocalImageBlob,
): Promise<{ blob: Blob; name: string }> {
  const { name, uri } = pickerFileMeta(asset);
  if (asset.file && isExpoFetchFilePart(asset.file)) return { blob: asset.file, name };
  if (!uri) throw new Error("Fotoğraf URI bulunamadı.");
  return { blob: await readFile(uri), name };
}

/** Satır görseli: dosya kaydı oluşur, teklif/keşif/proje galerisine yazılmaz. */
export function lineItemImageUploadRequest(companyId?: string) {
  return {
    path: "/files/upload",
    query: { entity: "product", entity_id: "", company_id: companyId || "" } as Record<string, string>,
  };
}

export function imageUploadRequest(
  entity: ImageEntity,
  entityId: string,
  companyId?: string,
  extra?: { stage?: string; stage_label?: string },
) {
  if (entity === "product") {
    return { path: `/products/${entityId}/image`, query: undefined as Record<string, string> | undefined };
  }
  const apiEntity = entity === "partner" ? "partner_photo" : entity === "employee" ? "employee_photo" : entity;
  const query: Record<string, string> = { entity: apiEntity, entity_id: entityId, company_id: companyId || "" };
  if (extra?.stage) query.stage = extra.stage;
  if (extra?.stage_label) query.stage_label = extra.stage_label;
  return { path: "/files/upload", query };
}

export function uploadedImageUrl(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const o = res as Record<string, unknown>;
  const product = o.product && typeof o.product === "object" ? (o.product as Record<string, unknown>) : null;
  const raw = o.url ?? o.image_url ?? product?.image_url ?? product?.thumbnail_url ?? product?.url;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

const COPY: Record<ImageEntity, { label: string; hint: string }> = {
  survey: { label: "Keşif fotoğrafları", hint: "Fotoğraflar WebP olarak küçültülür; web’deki keşif kartında da görünür." },
  project: { label: "Proje fotoğrafları", hint: "Fotoğraflar WebP olarak küçültülür; web’deki proje kartında da görünür." },
  quote: { label: "Teklif fotoğrafları", hint: "Fotoğraflar WebP olarak küçültülür; web’deki teklif kartında da görünür." },
  product: { label: "Stok kartı fotoğrafları", hint: "Fotoğraflar WebP olarak küçültülür; web’deki stok kartında da görünür." },
  partner: { label: "Ortak fotoğrafı", hint: "Fotoğraf ortak kartında görünür." },
  employee: { label: "Personel fotoğrafı", hint: "Fotoğraf personel kartında görünür." },
};

export function imageUploaderCopy(entity: ImageEntity) {
  return COPY[entity];
}

export function removeGalleryImage(images: string[] | null | undefined, url: string): string[] {
  const drop = String(url || "").trim();
  return (images || []).map((u) => String(u || "").trim()).filter((u) => u && u !== drop);
}
