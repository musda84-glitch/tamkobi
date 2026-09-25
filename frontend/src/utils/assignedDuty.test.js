import {
  DUTY_ATOLYE_ACTION,
  DUTY_PHOTO_ACTION,
  DUTY_COMPLETE_ACTION,
  DUTY_COMPLETE_APPROVED,
  DUTY_MAPS_ACTION,
  dutyCompleteTitle,
  matchAssignedDuty,
  dutyFromCurrent,
  applyDutyPhotoVisibility,
  dutyCanShowPhotos,
  dutyCanUploadPhotos,
  dutyHasProject,
  dutyIsField,
  dutyPhotosHint,
  dutyKindLabel,
  dutyPhotos,
  dutyShowAtolye,
  dutyShowSite,
  dutyWorkflowProgress,
  pendingDutyPhotoCount,
  photoFaded,
  photoVisibility,
  photoVisibilityLabel,
} from "./assignedDuty";
import { workMapsLink } from "./mapsLink";

describe("assigned duty field extras", () => {
  test("opens maps for a project assignment and tracks workflow", () => {
    const t = {
      id: "t1",
      kind: "field",
      title: "Montaj",
      project_id: "p1",
      project_number: "PRJ-2026-0006",
      project_name: "Aa",
      latitude: 40.1,
      longitude: 32.8,
      workflow: [{ title: "Montaj" }, { title: "Teslim", done: true }],
      photos: [{ url: "/api/files/a.jpg", source: "employee", visibility: "pending", task_id: "t1" }],
    };
    expect(DUTY_MAPS_ACTION).toBe("Görev yerine git");
    expect(DUTY_COMPLETE_ACTION).toBe("Görev tamamlandı");
    expect(dutyCompleteTitle({ done: true })).toBe(DUTY_COMPLETE_APPROVED);
    expect(matchAssignedDuty([{ id: "t1", title: "Montaj" }], { id: "t1" })?.title).toBe("Montaj");
    expect(dutyFromCurrent({
      tasks: [{ id: "t9", title: "aa", project_number: "PRJ-2026-0017", photos: [{ url: "/a.jpg" }] }],
      current: { title: "aa", project: "PRJ-2026-0017 · Fiyat Teklifi" },
      workplace: { kind: "task", task_title: "aa" },
    })?.photos?.[0]?.url).toBe("/a.jpg");
    expect(DUTY_ATOLYE_ACTION).toBe("Atölyeye git");
    expect(DUTY_PHOTO_ACTION).toBe("Resim yükle");
    expect(dutyIsField(t)).toBe(true);
    expect(dutyHasProject(t)).toBe(true);
    expect(dutyShowSite(t)).toBe(true);
    expect(dutyShowAtolye(t, true)).toBe(false);
    expect(dutyKindLabel(t)).toBe("Dış görev");
    expect(workMapsLink(t)).toContain("40.1");
    expect(dutyWorkflowProgress(t)).toEqual({ done: 1, total: 2 });
    expect(photoVisibility(t.photos[0])).toBe("pending");
    expect(photoFaded(t.photos[0])).toBe(true);
    expect(photoVisibilityLabel(t.photos[0])).toBe("Onay bekliyor");
    expect(pendingDutyPhotoCount([t])).toBe(1);
  });

  test("shows workshop only for office park duties", () => {
    expect(dutyIsField({ kind: "office", park_name: "CNC" })).toBe(false);
    expect(dutyHasProject({ kind: "office", park_name: "CNC" })).toBe(false);
    expect(dutyShowAtolye({ kind: "office" }, true)).toBe(true);
    expect(dutyShowSite({ kind: "office" })).toBe(false);
    expect(dutyKindLabel({ kind: "office" })).toBe("İç görev");
    expect(dutyCanShowPhotos({ id: "ot_1", kind: "office" })).toBe(true);
    expect(dutyCanUploadPhotos({ id: "ot_1", kind: "office", done: true }, false)).toBe(true);
    expect(dutyCanUploadPhotos({ id: "ot_1" }, true)).toBe(false);
    expect(dutyPhotosHint({ kind: "office" })).toMatch(/yapılan görev/);
  });

  test("keeps photos for the matching task and applies customer visibility", () => {
    const duty = {
      id: "t1",
      photos: [
        { url: "/api/files/a.jpg", source: "employee", visibility: "pending", task_id: "t1" },
        { url: "/api/files/b.jpg", source: "employee", visibility: "pending", task_id: "t2" },
      ],
    };
    expect(dutyPhotos(duty).map((p) => p.url)).toEqual(["/api/files/a.jpg"]);
    const shown = applyDutyPhotoVisibility(duty.photos, "/api/files/a.jpg", true);
    expect(photoVisibility(shown[0])).toBe("show");
    expect(photoVisibilityLabel(shown[0])).toBe("Müşteri görür");
  });
});
