import React, { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ImagePlus, Star, Trash2, Loader2, ImageIcon } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";

export const ProductImageGallery = ({ product, onUpdated }) => {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const images = product.images?.length ? product.images : (product.image_url ? [product.image_url] : []);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      setUploading(true);
      const res = await axios.post(`${API_URL}/products/${product.id}/image`, form, { withCredentials: true });
      toast.success("Görsel yüklendi.");
      onUpdated(res.data.product);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görsel yüklenemedi.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const saveImages = async (nextImages, cover) => {
    try {
      const res = await axios.put(`${API_URL}/products/${product.id}/images`, { images: nextImages, image_url: cover }, { withCredentials: true });
      onUpdated(res.data);
    } catch {
      toast.error("Görseller güncellenemedi.");
    }
  };

  return (
    <div className="space-y-3" data-testid="product-image-gallery">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {images.map((img) => {
          const isCover = img === product.image_url;
          return (
            <div key={img} className={`relative group aspect-square rounded-xl overflow-hidden border-2 ${isCover ? "border-emerald-500" : "border-slate-200"}`} data-testid="product-image-item">
              <img src={resolveImageUrl(img)} alt={product.name} className="w-full h-full object-cover" />
              {isCover && (
                <span className="absolute top-1.5 left-1.5 bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">Kapak</span>
              )}
              <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                {!isCover && (
                  <button type="button" onClick={() => saveImages(images, img)} className="p-1.5 bg-white rounded-lg text-amber-600 hover:bg-amber-50" title="Kapak Yap" data-testid="set-cover-image-btn">
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = images.filter((i) => i !== img);
                    saveImages(next, isCover ? next[0] || null : product.image_url);
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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/40 transition flex flex-col items-center justify-center gap-1.5 text-slate-500 hover:text-emerald-700 text-xs font-semibold"
          data-testid="upload-product-image-btn"
        >
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
          {uploading ? "Yükleniyor..." : "Görsel Ekle"}
        </button>
      </div>
      {images.length === 0 && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Henüz görsel yok. JPG, PNG veya WEBP (maks. 5 MB) yükleyebilirsiniz.</p>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleUpload} data-testid="product-image-file-input" />
    </div>
  );
};
