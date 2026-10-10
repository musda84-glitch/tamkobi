import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Eye, EyeOff, ImagePlus, X } from "lucide-react";
import { photoFaded, photoVisibility } from "../utils/assignedDuty";
import { API_URL } from "../context/AuthContext";
import { compressImageFile } from "../utils/compressImage";
import { HoverImageThumb } from "../utils/HoverImageThumb";

export function ProjectStagePhotos({ project, stages, onUpdated }) {
  const [busy, setBusy] = useState("");
  const id = project?.id || project?._id;
  const number = project?.project_number || id;
  const photos = Array.isArray(project?.stage_photos) ? project.stage_photos : [];
  const byStage = {};
  photos.forEach((p) => {
    const key = p.stage || "other";
    if (!byStage[key]) byStage[key] = [];
    byStage[key].push(p);
  });
  const tagged = new Set(photos.map((p) => p.url));
  const loose = (project?.images || []).filter((url) => url && !tagged.has(url));
  const known = new Set((stages || []).map((s) => s.key));
  const extra = Object.keys(byStage).filter((k) => k !== "other" && !known.has(k));
  const rows = [
    ...(stages || []),
    ...extra.map((k) => ({ key: k, label: byStage[k]?.[0]?.stage_label || k })),
  ];
  rows.push({ key: "other", label: "Keşif fotoğrafı" });

  const upload = async (stage, event) => {
    const raw = event.target.files?.[0];
    event.target.value = "";
    if (!raw || !id) {
      toast.error("Önce projeyi kaydedin, sonra fotoğraf ekleyin.");
      return;
    }
    const file = await compressImageFile(raw);
    const fd = new FormData();
    fd.append("file", file);
    setBusy(stage.key);
    try {
      const params = new URLSearchParams({
        entity: "project",
        entity_id: id,
        company_id: project.company_id || "",
        stage: stage.key,
        stage_label: stage.label || "",
      });
      await axios.post(`${API_URL}/files/upload?${params.toString()}`, fd);
      toast.success(`${stage.label} aşamasına fotoğraf yüklendi.`);
      onUpdated?.();
    } catch (err) {
      const status = err.response?.status;
      const rawBody = err.response?.data;
      const detail = typeof rawBody === "string" ? "" : rawBody?.detail;
      const tooBig = status === 413 || (typeof rawBody === "string" && rawBody.includes("413"));
      toast.error(tooBig ? "Fotoğraf çok büyük. Daha küçük bir görsel seçin." : (detail || "Yüklenemedi."));
    } finally {
      setBusy("");
    }
  };

  const setVisibility = async (url, visible) => {
    if (!id) return;
    try {
      const r = await axios.post(`${API_URL}/projects/${id}/stage-photos/visibility`, { url, visible });
      toast.success(r.data.message || (visible ? "Müşteri görür." : "Müşteri görmez."));
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Onay kaydedilemedi.");
    }
  };

  const remove = async (url) => {
    const next = photos.filter((p) => p.url !== url);
    const images = (project.images || []).filter((u) => u !== url);
    try {
      await axios.put(`${API_URL}/projects/${id}`, { stage_photos: next, images });
      toast.success("Fotoğraf kaldırıldı.");
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaldırılamadı.");
    }
  };

  return (
    <div className="space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50/70" data-testid={`project-stage-photos-${number}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Aşama fotoğrafları</div>
      <p className="text-[10px] text-slate-400 leading-snug">
        Fotoğrafın üzerine gelince önizleme açılır; tıklayınca büyütülür.
        Alttaki göz düğmesi müşteri görünürlüğünü açar/kapatır; silik foto müşteriye kapalıdır.
      </p>
      {(() => {
        const current = (stages || []).find((s) => s.key === project.status) || (stages || [])[0];
        if (!current) return null;
        return (
          <label className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border-2 border-dashed cursor-pointer font-semibold ${busy === current.key ? "opacity-50 border-slate-200 text-slate-400" : "border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-50"}`} data-testid={`project-stage-upload-bar-${number}`}>
            {busy === current.key ? "Yükleniyor…" : <><ImagePlus className="w-3.5 h-3.5" /> {current.label} aşamasına fotoğraf yükle</>}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" capture="environment" className="hidden" disabled={!!busy} onChange={(e) => upload(current, e)} data-testid={`project-stage-upload-main-${number}`} />
          </label>
        );
      })()}
      {rows.map((stage) => {
        const items = stage.key === "other"
          ? [...(byStage.other || []), ...loose.map((url) => ({ url, loose: true }))]
          : (byStage[stage.key] || []);
        return (
          <div key={stage.key} className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-1.5" data-testid={`project-stage-row-${number}-${stage.key}`}>
            <span title={stage.label} className={`h-10 flex items-center whitespace-nowrap text-[10px] font-semibold px-1.5 rounded ${stage.key === project.status ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-500 border border-slate-200"}`}>{stage.label}</span>
            <div className="flex items-start gap-1.5 flex-wrap min-w-0">
              {items.map((item) => {
                const vis = photoVisibility(item);
                const customerSees = vis === "show";
                return (
                  <span key={item.url} className="inline-flex flex-col items-center gap-0.5 w-10">
                    <HoverImageThumb
                      src={item.url}
                      className={`w-10 h-10 rounded-lg object-cover border bg-white ${photoFaded(item) ? "opacity-35" : ""}`}
                      testId={`project-stage-thumb-${number}`}
                    />
                    {/* Tek görünürlük anahtarı + sil — thumb dışında, önizlemeyi engellemez */}
                    <div className="flex items-center justify-center gap-0.5" data-testid={`project-stage-vis-${number}`}>
                      <button
                        type="button"
                        onClick={() => setVisibility(item.url, !customerSees)}
                        title={customerSees ? "Müşteri görür — tıkla: gizle" : "Müşteri görmez — tıkla: göster"}
                        aria-pressed={customerSees}
                        aria-label={customerSees ? "Müşteri görür, gizle" : "Müşteri görmez, göster"}
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          customerSees
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                            : "bg-rose-50 border-rose-300 text-rose-600"
                        }`}
                        data-testid={`project-stage-vis-toggle-${number}`}
                        data-visible={customerSees ? "1" : "0"}
                      >
                        {customerSees ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item.url)}
                        title="Kaldır"
                        className="w-4 h-4 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-rose-600 flex items-center justify-center"
                        data-testid={`project-stage-remove-${number}`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </span>
                );
              })}
              <label className={`w-10 h-10 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer shrink-0 ${busy === stage.key ? "opacity-50 border-slate-200" : "border-slate-300 hover:border-emerald-500 text-slate-400 bg-white"}`} title={`${stage.label} aşamasına fotoğraf yükle`}>
                {busy === stage.key ? <span className="text-[9px]">…</span> : <ImagePlus className="w-4 h-4" />}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" capture="environment" className="hidden" disabled={!!busy} onChange={(e) => upload(stage, e)} data-testid={`project-stage-upload-${number}-${stage.key}`} />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
