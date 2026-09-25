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
  dutySiteHint,
  dutyWorkflowProgress,
  pendingDutyPhotoCount,
  photoVisibility,
  photoVisibilityLabel,
} from "./assignedDuty";
import { mapsLink } from "./geo";

describe("assigned duty field extras", () => {
  it("opens maps for a project assignment and tracks workflow", () => {
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
    expect(dutyCompleteTitle({ busy: true })).toBe("Tamamlanıyor…");
    expect(matchAssignedDuty([{ id: "t1", title: "Montaj" }, { id: "t2", title: "Keşif" }], { id: "t1" })?.title).toBe("Montaj");
    expect(dutyFromCurrent({
      tasks: [{ id: "t9", title: "aa", project_number: "PRJ-2026-0017", project_name: "Fiyat Teklifi", photos: [{ url: "/a.jpg" }], done: true }],
      current: { id: "wp", title: "aa", project: "PRJ-2026-0017 · Fiyat Teklifi" },
      workplace: { kind: "task", task_title: "aa", project_number: "PRJ-2026-0017" },
    })?.photos?.[0]?.url).toBe("/a.jpg");
    expect(DUTY_ATOLYE_ACTION).toBe("Atölyeye git");
    expect(DUTY_PHOTO_ACTION).toBe("Resim yükle");
    expect(dutyIsField(t)).toBe(true);
    expect(dutyHasProject(t)).toBe(true);
    expect(dutyShowSite(t)).toBe(true);
    expect(dutyShowAtolye(t, true)).toBe(false);
    expect(dutyKindLabel(t)).toBe("Dış görev");
    expect(mapsLink(t)).toContain("40.1");
    expect(dutyWorkflowProgress(t)).toEqual({ done: 1, total: 2 });
    expect(photoVisibility(t.photos[0])).toBe("pending");
    expect(photoVisibilityLabel(t.photos[0])).toBe("Onay bekliyor");
    expect(pendingDutyPhotoCount([t])).toBe(1);
  });

  it("shows workshop only for office park duties", () => {
    const office = { kind: "office" as const, park_name: "CNC", title: "Delik" };
    expect(dutyIsField(office)).toBe(false);
    expect(dutyHasProject(office)).toBe(false);
    expect(dutyShowAtolye(office, true)).toBe(true);
    expect(dutyShowSite(office)).toBe(false);
    expect(dutyKindLabel(office)).toBe("İç görev");
    expect(dutyCanShowPhotos({ id: "ot_1", kind: "office" })).toBe(true);
    expect(dutyCanUploadPhotos({ id: "ot_1", kind: "office", done: true }, false)).toBe(true);
    expect(dutyCanUploadPhotos({ id: "ot_1" }, true)).toBe(false);
    expect(dutyPhotosHint({ kind: "office" })).toMatch(/yapılan görev/);
    expect(mapsLink({ address: "" })).toBeNull();
    expect(dutySiteHint({ project_number: "PRJ-1", address: "Ankara" })).toBe("PRJ-1 · Ankara");
  });

  it("keeps photos for the matching task and applies customer visibility", () => {
    const duty = {
      id: "t1",
      kind: "field",
      photos: [
        { url: "/api/files/a.jpg", source: "employee", visibility: "pending", task_id: "t1" },
        { url: "/api/files/b.jpg", source: "employee", visibility: "pending", task_id: "t2" },
      ],
    };
    expect(dutyPhotos(duty).map((p) => p.url)).toEqual(["/api/files/a.jpg"]);
    const shown = applyDutyPhotoVisibility(duty.photos, "/api/files/a.jpg", true);
    expect(photoVisibility(shown[0])).toBe("show");
    expect(photoVisibilityLabel(shown[0])).toBe("Müşteri görür");
    const hidden = applyDutyPhotoVisibility(shown, "/api/files/a.jpg", false);
    expect(photoVisibility(hidden[0])).toBe("hide");
  });
});
