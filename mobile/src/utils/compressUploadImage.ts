import type { PickerAssetLike } from "./formDataFile";

/** Mobil yükleme: WebP (yoksa JPEG), uzun kenar 1600px — web compressImage + sunucu image_opt ile uyumlu. */
export const UPLOAD_IMAGE = {
  maxEdge: 1600,
  quality: 0.72,
  skipUnderBytes: 32 * 1024,
  minSavings: 0.05,
} as const;

export type ResizeAction = { resize: { width: number; height?: number } };
export type ManipulateFn = (
  uri: string,
  actions: ResizeAction[],
  format: "webp" | "jpeg",
) => Promise<{ uri?: string } | null>;

export function scaledSize(width: number, height: number, maxEdge = UPLOAD_IMAGE.maxEdge) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const edge = Math.max(w, h);
  if (!edge || edge <= maxEdge) return { width: w, height: h, resized: false };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

export function uploadImageFileName(originalName: string | null | undefined, mime: string) {
  const base = String(originalName || "photo").replace(/\.[^.]+$/, "").trim() || "photo";
  if (mime === "image/webp") return `${base}.webp`;
  if (mime === "image/png") return `${base}.png`;
  return `${base}.jpg`;
}

export function skipImageCompress(mime: string, bytes = 0) {
  const type = (mime || "").toLowerCase();
  if (type === "image/gif" || type === "image/heic" || type === "image/heif") return true;
  return bytes > 0 && bytes < UPLOAD_IMAGE.skipUnderBytes;
}

export function resizeActions(width: number, height: number, maxEdge = UPLOAD_IMAGE.maxEdge): ResizeAction[] {
  const size = scaledSize(width, height, maxEdge);
  return size.resized ? [{ resize: { width: size.width } }] : [];
}

export async function manipulateUploadImage(
  uri: string,
  actions: ResizeAction[],
  format: "webp" | "jpeg",
): Promise<{ uri?: string } | null> {
  const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
  const fmt = format === "webp" ? SaveFormat.WEBP : SaveFormat.JPEG;
  return manipulateAsync(uri, actions, { compress: UPLOAD_IMAGE.quality, format: fmt });
}

export async function compressPickerAsset(
  asset: PickerAssetLike & { width?: number; height?: number; fileSize?: number },
  manipulate: ManipulateFn = manipulateUploadImage,
): Promise<PickerAssetLike> {
  const mime = (asset.mimeType || "").toLowerCase();
  const bytes = asset.fileSize || (asset.file && "size" in asset.file ? Number(asset.file.size) || 0 : 0);
  const uri = (asset.uri || "").trim();
  if (!uri || skipImageCompress(mime, bytes)) return asset;

  const actions = resizeActions(asset.width || 0, asset.height || 0);
  for (const format of ["webp", "jpeg"] as const) {
    try {
      const out = await manipulate(uri, actions, format);
      if (out?.uri) {
        const nextMime = format === "webp" ? "image/webp" : "image/jpeg";
        return {
          uri: out.uri,
          fileName: uploadImageFileName(asset.fileName, nextMime),
          mimeType: nextMime,
        };
      }
    } catch {
      /* diğer format */
    }
  }
  return asset;
}
