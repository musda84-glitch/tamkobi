import {
  appendStagePhoto,
  cleanStageKey,
  groupStagePhotos,
  removeStagePhoto,
  sanitizeStagePhotos,
  stagePhotoCount,
  stagePhotoFaded,
  stagePhotoHoldHint,
  stagePhotoRows,
  SURVEY_STAGE_PHOTO_LABEL,
} from "./stagePhotos";

const stages = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

describe("stagePhotos", () => {
  it("sanitizes keys and drops foreign urls like the API", () => {
    expect(cleanStageKey("active!")).toBe("active");
    expect(sanitizeStagePhotos([
      { url: "/api/files/ok.jpg", stage: "active!", stage_label: "Devam" },
      { url: "https://evil.example/x.jpg", stage: "active" },
      "nope",
    ])).toMatchObject([{
      url: "/api/files/ok.jpg",
      stage: "active",
      stage_label: "Devam",
      created_at: "",
    }]);
  });

  it("groups by company stages and keeps loose images as Keşif fotoğrafı", () => {
    const groups = groupStagePhotos(
      [
        { url: "/api/files/a.jpg", stage: "active", stage_label: "Devam Ediyor" },
        { url: "/api/files/b.jpg", stage: "planning" },
      ],
      ["/api/files/a.jpg", "/api/files/b.jpg", "/api/files/eski.jpg"],
      stages,
    );
    expect(groups.map((g) => g.stage)).toEqual(["planning", "active", "other"]);
    expect(groups[0].label).toBe("Planlama");
    expect(groups[1].images).toEqual(["/api/files/a.jpg"]);
    expect(groups[2]).toEqual({ stage: "other", label: SURVEY_STAGE_PHOTO_LABEL, images: ["/api/files/eski.jpg"] });
    expect(SURVEY_STAGE_PHOTO_LABEL).toBe("Keşif fotoğrafı");
  });

  it("marks past stages done and current stage for the customer timeline", () => {
    const rows = stagePhotoRows({
      status: "active",
      stage_photos: [{ url: "/api/files/a.jpg", stage: "planning" }],
      images: ["/api/files/a.jpg", "/api/files/loose.jpg"],
    }, stages);
    expect(rows.find((r) => r.key === "planning")).toMatchObject({ current: false, done: true, items: [{ url: "/api/files/a.jpg", stage: "planning" }] });
    expect(rows.find((r) => r.key === "active")).toMatchObject({ current: true, done: false });
    expect(rows.find((r) => r.key === "other")).toMatchObject({ label: "Keşif fotoğrafı" });
    expect(rows.find((r) => r.key === "other")?.items.map((i) => i.url)).toEqual(["/api/files/loose.jpg"]);
    expect(stagePhotoCount({ stage_photos: [{ url: "/api/files/a.jpg", stage: "planning" }], images: ["/api/files/a.jpg", "/api/files/loose.jpg"] })).toBe(2);
    expect(stagePhotoFaded({ url: "/api/files/a.jpg", stage: "planning", source: "employee" })).toBe(true);
    expect(stagePhotoFaded({ url: "/api/files/a.jpg", stage: "planning", visibility: "show", customer_visible: true })).toBe(false);
    expect(stagePhotoHoldHint()).toMatch(/Basılı tutun/);
  });

  it("appends and removes a stage photo without dropping other images", () => {
    const added = appendStagePhoto(
      [{ url: "/api/files/a.jpg", stage: "planning" }],
      ["/api/files/a.jpg"],
      { url: "/api/files/b.jpg", stage: "active", stage_label: "Devam Ediyor" },
    );
    expect(added.stage_photos).toHaveLength(2);
    expect(added.images).toEqual(["/api/files/a.jpg", "/api/files/b.jpg"]);
    expect(removeStagePhoto(added.stage_photos, added.images, "/api/files/a.jpg")).toMatchObject({
      stage_photos: [{ url: "/api/files/b.jpg", stage: "active", stage_label: "Devam Ediyor", created_at: "" }],
      images: ["/api/files/b.jpg"],
    });
  });
});
