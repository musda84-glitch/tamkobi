import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Circle, Factory, ImagePlus, MapPin, Navigation } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { compressImageFile } from "../utils/compressImage";
import { resolveImageUrl } from "../utils/imageUrl";
import { workMapsLink } from "../utils/mapsLink";
import {
  DUTY_ATOLYE_ACTION,
  DUTY_COMPLETE_CONFIRM,
  dutyCompleteTitle,
  DUTY_PHOTO_HIDE,
  DUTY_PHOTO_SHOW,
  DUTY_PHOTOS_HINT,
  DUTY_SITE_ACTION,
  applyDutyPhotoVisibility,
  dutyHasProject,
  dutyIsField,
  dutyKindLabel,
  dutyPhotos,
  dutyShowAtolye,
  dutyShowSite,
  dutySiteHint,
  dutySubtitle,
  dutyWorkflow,
  dutyWorkflowProgress,
  photoVisibility,
  photoVisibilityLabel,
} from "../utils/assignedDuty";

export function AssignedDutyCard({
  duty,
  index = 0,
  onApprove,
  onChanged,
  approveBusy = false,
  showAtolye = false,
  reviewPhotos = false,
  testId,
}) {
  const tid = testId || `duty-${duty?.id || index}`;
  const [openFlow, setOpenFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visBusy, setVisBusy] = useState(null);
  const flow = dutyWorkflow(duty);
  const progress = dutyWorkflowProgress(duty);
  const photos = dutyPhotos(duty);
  const mapHref = workMapsLink(duty);
  const field = dutyIsField(duty);
  const showWorkshop = dutyShowAtolye(duty, showAtolye);
  const showSite = dutyShowSite(duty);
  const canReview = reviewPhotos && field && Boolean(duty?.project_id);

  const uploadPhoto = async (event) => {
    const raw = event.target.files?.[0];
    event.target.value = "";
    if (!raw || !duty?.id) {
      toast.error("Görev bulunamadı.");
      return;
    }
    const file = await compressImageFile(raw);
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/tasks/${duty.id}/photos`, fd, { withCredentials: true });
      toast.success(r.data.message || "Fotoğraf yüklendi. Yönetici onayı bekleniyor.");
      onChanged?.(r.data.task);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const setVisibility = async (photo, visible) => {
    if (!duty?.project_id) {
      toast.error("Proje numarası yok.");
      return;
    }
    setVisBusy(`${photo.url}:${visible ? "show" : "hide"}`);
    try {
      await axios.post(`${API_URL}/projects/${duty.project_id}/stage-photos/visibility`, { url: photo.url, visible }, { withCredentials: true });
      toast.success(visible ? "Müşteri görür." : "Müşteri görmez.");
      onChanged?.({ ...duty, photos: applyDutyPhotoVisibility(duty.photos || photos, photo.url, visible) });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Onay kaydedilemedi.");
    } finally {
      setVisBusy(null);
    }
  };

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${duty?.done ? "border-emerald-200 opacity-70" : "border-indigo-200 bg-white"}`} data-testid={tid}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className={`font-bold text-slate-900 leading-tight ${duty?.done ? "line-through" : ""}`}>{duty?.title || "Görev"}</div>
          <div className="text-xs text-slate-500 mt-0.5">{[dutyKindLabel(duty), dutySubtitle(duty)].filter(Boolean).join(" · ")}</div>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold ${duty?.done ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>{duty?.done ? "Tamam" : "Açık"}</span>
      </div>
      {showSite && (
        <div className="space-y-1">
          {mapHref ? (
            <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-rose-600 text-white text-xs font-bold" data-testid={`${tid}-maps`}>
              <Navigation className="w-3.5 h-3.5" /> {DUTY_SITE_ACTION}
            </a>
          ) : (
            <div className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-rose-600 text-white text-xs font-bold" data-testid={`${tid}-maps`}>
              <Navigation className="w-3.5 h-3.5" /> {DUTY_SITE_ACTION}
            </div>
          )}
          <div className="text-[11px] text-slate-500" data-testid={`${tid}-site-hint`}>{dutySiteHint(duty)}</div>
        </div>
      )}
      {flow.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpenFlow((v) => !v)} className="text-[11px] font-bold text-slate-600" data-testid={`${tid}-flow-toggle`}>
            İş akışı {progress.done}/{progress.total} {openFlow ? "· gizle" : "· göster"}
          </button>
          {openFlow && (
            <ul className="mt-2 space-y-1" data-testid={`${tid}-flow`}>
              {flow.map((step, i) => (
                <li key={step.id || i} className="flex items-center gap-2 text-xs">
                  {step.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                  <span className={step.done ? "text-slate-500 line-through" : "text-slate-800"}>{step.title}</span>
                  {step.assignee_name ? <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{step.assignee_name}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(dutyHasProject(duty) || (reviewPhotos && photos.length > 0)) && (
        <div className="space-y-2" data-testid={`${tid}-photos`}>
          <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> {DUTY_PHOTOS_HINT}</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => {
              const vis = photoVisibility(p);
              return (
                <div key={p.url} className="w-16" data-testid={`${tid}-photo-${p.url}`}>
                  <a href={resolveImageUrl(p.url)} target="_blank" rel="noreferrer" className="block">
                    <img src={resolveImageUrl(p.url)} alt="" className="w-16 h-16 object-cover rounded-lg border bg-white" />
                  </a>
                  <div className={`text-[9px] font-bold leading-tight mt-0.5 ${vis === "show" ? "text-emerald-700" : vis === "hide" ? "text-rose-600" : "text-slate-500"}`}>{photoVisibilityLabel(p)}</div>
                  {canReview ? (
                    <div className="flex gap-1 mt-0.5">
                      <button type="button" disabled={!!visBusy} onClick={() => setVisibility(p, true)} className={`text-[8px] font-bold ${vis === "show" ? "text-emerald-700" : "text-slate-400"}`} data-testid={`${tid}-photo-show`}>
                        {visBusy === `${p.url}:show` ? "…" : DUTY_PHOTO_SHOW}
                      </button>
                      <button type="button" disabled={!!visBusy} onClick={() => setVisibility(p, false)} className={`text-[8px] font-bold ${vis === "hide" ? "text-rose-600" : "text-slate-400"}`} data-testid={`${tid}-photo-hide`}>
                        {visBusy === `${p.url}:hide` ? "…" : DUTY_PHOTO_HIDE}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!photos.length && reviewPhotos ? <div className="text-[10px] text-slate-400">Henüz iş fotoğrafı yok.</div> : null}
            {!duty?.done && !reviewPhotos && (
              <label className={`w-14 h-14 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer ${busy ? "opacity-50" : "border-indigo-300 text-indigo-700 bg-white"}`} data-testid={`${tid}-photo`}>
                {busy ? "…" : <ImagePlus className="w-5 h-5" />}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" capture="environment" className="hidden" disabled={busy} onChange={uploadPhoto} />
              </label>
            )}
          </div>
        </div>
      )}
      {(showWorkshop || onApprove || duty?.done) && (
        <div className="flex flex-wrap gap-2">
          {showWorkshop && !duty?.done && (
            <a href="/atolye" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold" data-testid={`${tid}-atolye`}>
              <Factory className="w-3.5 h-3.5" /> {DUTY_ATOLYE_ACTION}
            </a>
          )}
          {duty?.done ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold" data-testid={`${tid}-approved`}>
              <CheckCircle2 className="w-3.5 h-3.5" /> {dutyCompleteTitle({ done: true })}
            </span>
          ) : onApprove ? (
            <button
              type="button"
              disabled={approveBusy}
              onClick={() => { if (window.confirm(DUTY_COMPLETE_CONFIRM)) onApprove(); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
              data-testid={`${tid}-approve`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> {dutyCompleteTitle({ busy: approveBusy })}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
