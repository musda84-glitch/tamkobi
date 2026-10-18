import React from "react";

export function projectPhotoItems(project) {
  const photos = Array.isArray(project?.stage_photos) ? project.stage_photos : [];
  const tagged = new Set(photos.map((photo) => photo?.url).filter(Boolean));
  const loose = (project?.images || []).filter((url) => url && !tagged.has(url));
  return [
    ...photos.filter((photo) => photo?.url).map((photo) => ({
      url: photo.url,
      stage: photo.stage,
      stage_label: photo.stage_label,
    })),
    ...loose.map((url) => ({ url, stage: "other", stage_label: "Keşif fotoğrafı", loose: true })),
  ];
}

function stageLabel(photo, stages) {
  if (photo?.stage_label) return photo.stage_label;
  if (photo?.loose || photo?.stage === "other") return "Keşif fotoğrafı";
  const hit = (stages || []).find((stage) => stage.key === photo?.stage);
  return hit?.label || photo?.stage || "";
}

export function ProjectPhotoStrip({ project, stages = [], onOpenPhotos }) {
  const number = project?.project_number;
  const items = projectPhotoItems(project);
  const thumbs = items.slice(0, 4);
  const lastLabel = items.length ? stageLabel(items[items.length - 1], stages) : "";
  const caption = items.length
    ? `📷 ${items.length} fotoğraf${lastLabel ? ` · ${lastLabel}` : ""}`
    : "Fotoğraf yok";
  const current = (stages || []).find((stage) => stage.key === project?.status) || (stages || [])[0];

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" data-testid={`project-photo-strip-${number}`}>
      {thumbs.length > 0 && (
        <div className="flex items-center gap-1">
          {thumbs.map((photo) => (
            <img
              key={photo.url}
              src={photo.url}
              alt=""
              className="h-10 w-10 rounded-lg border border-slate-200 bg-white object-cover"
              data-testid={`project-photo-thumb-${number}`}
            />
          ))}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[11px] text-slate-500">{caption}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {current ? (
            <button
              type="button"
              onClick={() => onOpenPhotos?.()}
              className="font-semibold text-emerald-700 hover:underline"
              data-testid={`project-photo-upload-open-${number}`}
            >
              {`＋ ${current.label} fotoğrafı yükle`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenPhotos?.()}
            className="font-semibold text-slate-500 hover:text-slate-700"
            data-testid={`project-photo-all-${number}`}
          >
            Tümü ›
          </button>
        </div>
      </div>
    </div>
  );
}
