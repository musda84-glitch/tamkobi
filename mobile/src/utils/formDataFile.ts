/** RN native FormData yalnız {uri,name,type} kabul eder; File/Blob UnsupportedFormDataPart atar. */

export type ImageEntity = "survey" | "project" | "quote" | "product";

export type PickerAssetLike = {
  uri?: string;
  fileName?: string | null;
  mimeType?: string | null;
  file?: Blob;
};

export type NativeFormFile = { uri: string; name: string; type: string };
export type WebFormFile = { file: Blob; name: string };
export type PickerFormPart = WebFormFile | NativeFormFile;

export function isWebFormFile(part: PickerFormPart): part is WebFormFile {
  return "file" in part;
}

export function pickerFormPart(
  asset: PickerAssetLike,
  platform: string,
  fallbackName = "photo.jpg",
): PickerFormPart {
  const name = (asset.fileName || "").trim() || fallbackName;
  const type = (asset.mimeType || "").trim() || "image/jpeg";
  if (platform === "web" && asset.file) return { file: asset.file, name };
  const uri = (asset.uri || "").trim();
  if (!uri) throw new Error("Fotoğraf URI bulunamadı.");
  return { uri, name, type };
}

export function appendPickerAsset(
  form: FormData,
  asset: PickerAssetLike,
  platform: string,
  field = "file",
): void {
  const part = pickerFormPart(asset, platform);
  if (isWebFormFile(part)) {
    form.append(field, part.file, part.name);
    return;
  }
  form.append(field, part as unknown as Blob);
}

export function imageUploadRequest(entity: ImageEntity, entityId: string, companyId?: string) {
  if (entity === "product") {
    return { path: `/products/${entityId}/image`, query: undefined as Record<string, string> | undefined };
  }
  return {
    path: "/files/upload",
    query: { entity, entity_id: entityId, company_id: companyId || "" },
  };
}

export function uploadedImageUrl(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const o = res as Record<string, unknown>;
  const product = o.product && typeof o.product === "object" ? (o.product as Record<string, unknown>) : null;
  const raw = o.url ?? o.image_url ?? product?.image_url ?? product?.thumbnail_url ?? product?.url;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

const COPY: Record<ImageEntity, { label: string; hint: string }> = {
  survey: { label: "Keşif fotoğrafları", hint: "Yüklenen fotoğraflar web’deki keşif kartında da görünür." },
  project: { label: "Proje fotoğrafları", hint: "Yüklenen fotoğraflar web’deki proje kartında da görünür." },
  quote: { label: "Teklif fotoğrafları", hint: "Yüklenen fotoğraflar web’deki teklif kartında da görünür." },
  product: { label: "Stok kartı fotoğrafları", hint: "Yüklenen fotoğraflar web’deki stok kartında da görünür." },
};

export function imageUploaderCopy(entity: ImageEntity) {
  return COPY[entity];
}
