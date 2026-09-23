import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ImagePlus, Star, Trash2, Loader2, ImageIcon, X, Tag } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressProductImageFile } from "../utils/compressImage";
import { productGalleryUrls, productIdOf, mediaRef, productLabelImageUrl } from "../utils/productImages";
import { ImageCropModal } from "./ImageCropModal";

export const ProductImageGallery = ({ product, onUpdated }) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState("");
  const [broken, setBroken] = useState({});
  const [cropFile, setCropFile] = useState(null);
  const pid = productIdOf(product);
  const images = productGalleryUrls(product);
  const cover = mediaRef(product?.image_url);
  const labelImg = productLabelImageUrl(product);

  const pickFile = (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw || !pid) return;
    if (!raw.type?.startsWith("image/")) {
      toast.error("Lütfen bir görsel dosyası seçin.");
      return;
    }
    // GIF/HEIC: kırpma canvas desteklemez — doğrudan yükle
    if (raw.type === "image/gif" || raw.type === "image/heic" || raw.type === "image/heif") {
      uploadFile(raw);
      return;
    }
    setCropFile(raw);
  };

  const uploadFile = async (raw) => {
    if (!raw || !pid) return;
    setUploading(true);
    try {
      const file = await compressProductImageFile(raw);
      const form = new FormData();
      form.append("file", file);
      const res = await axios.post(`${API_URL}/products/${pid}/image`, form, { withCredentials: true });
      const saved = res.data?.product;
      if (!saved || !productIdOf(saved)) {
        toast.error("Görsel kaydedildi ama kart yenilenemedi.");
        return;
      }
      const savedPct = res.data?.saved_pct;
      const kb = Math.max(1, Math.round((file.size || 0) / 1024));
      toast.success(savedPct ? `Görsel yüklendi (≈%${savedPct} küçültüldü, ${kb} KB).` : `Görsel yüklendi (${kb} KB).`);
      onUpdated(saved);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görsel yüklenemedi.");
    } finally {
      setUploading(false);
      setCropFile(null);
      try { window.scrollTo(0, window.scrollY); } catch { /* iOS file-picker */ }
    }
  };

  const saveImages = async (nextImages, nextCover, nextLabel) => {
    if (!pid) return;
    try {
      const payload = { images: nextImages, image_url: nextCover };
      if (nextLabel !== undefined) payload.label_image_url = nextLabel || null;
      const res = await axios.put(`${API_URL}/products/${pid}/images`, payload, { withCredentials: true });
      if (!res.data || !productIdOf(res.data)) {
        toast.error("Görseller güncellenemedi.");
        return;
      }
      onUpdated(res.data);
    } catch {
      toast.error("Görseller güncellenemedi.");
    }
  };

  return (
    <div className="space-y-3" data-testid="product-image-gallery">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {images.map((img, i) => {
          const isCover = img === cover;
          const isLabel = img === labelImg;
          const src = resolveImageUrl(img);
          return (
            <div key={`${i}-${img}`} className={`relative group aspect-square rounded-xl overflow-hidden border-2 bg-slate-50 ${isCover ? "border-emerald-500" : isLabel ? "border-indigo-400" : "border-slate-200"}`} data-testid="product-image-item">
              {broken[img] || !src ? (
                <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon className="w-8 h-8" /></div>
              ) : (
                <button type="button" className="w-full h-full" onClick={() => setPreview(img)} title="Önizle" data-testid="product-image-open">
                  <img
                    src={src}
                    alt={product.name || ""}
                    className="w-full h-full object-cover"
                    onError={() => setBroken((b) => ({ ...b, [img]: true }))}
                  />
                </button>
              )}
              <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 pointer-events-none">
                {isCover && <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">Kapak</span>}
                {isLabel && <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">Etiket</span>}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-slate-900/55 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-1.5 py-1.5">
                {!isCover && (
                  <button type="button" onClick={() => saveImages(images, img, product.label_image_url)} className="p-1.5 bg-white rounded-lg text-amber-600 hover:bg-amber-50" title="Kapak Yap" data-testid="set-cover-image-btn">
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => saveImages(images, cover, isLabel ? null : img)}
                  className={`p-1.5 bg-white rounded-lg hover:bg-indigo-50 ${isLabel ? "text-indigo-700" : "text-indigo-500"}`}
                  title={isLabel ? "Etiket görselini kaldır" : "Etiket görseli yap"}
                  data-testid="set-label-image-btn"
                >
                  <Tag className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = images.filter((u) => u !== img);
                    const nextLabel = isLabel ? (next[0] || null) : (product.label_image_url === img ? null : product.label_image_url);
                    saveImages(next, isCover ? next[0] || null : cover, nextLabel);
                  }}
                  className="p-1.5 bg-white rounded-lg text-rose-600 hover:bg-rose-50"
                  title="Kaldır"
                  data-testid="remove-image-btn"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        <label
          className={`aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/40 transition flex flex-col items-center justify-center gap-1.5 text-slate-500 hover:text-emerald-700 text-xs font-semibold ${uploading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
          data-testid="upload-product-image-btn"
        >
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
          {uploading ? "Yükleniyor..." : "Görsel Ekle"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/*"
            className="sr-only"
            onChange={pickFile}
            disabled={uploading}
            data-testid="product-image-file-input"
          />
        </label>
      </div>
      {images.length === 0 && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Henüz görsel yok. Yüklerken kırpabilir; WebP/JPEG olarak sıkıştırılır (maks. 5 MB).</p>
      )}
      {images.length > 0 && (
        <p className="text-[11px] text-slate-500">Kapak: liste/kart. <span className="text-indigo-600 font-semibold">Etiket</span>: barkod etiket tasarımında kullanılan görsel (etiket ikonuna tıklayın).</p>
      )}
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={async (cropped) => { await uploadFile(cropped); }}
        />
      )}
      {preview ? (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/80 flex items-center justify-center p-4"
          onClick={() => setPreview("")}
          data-testid="product-image-preview"
        >
          <button type="button" className="absolute top-4 right-4 p-2 rounded-full bg-white/90 text-slate-700" aria-label="Kapat" data-testid="product-image-preview-close">
            <X className="w-5 h-5" />
          </button>
          <img
            src={resolveImageUrl(preview)}
            alt=""
            className="max-h-[85vh] max-w-full object-contain rounded-lg bg-white shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
};
