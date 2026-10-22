import {
  applyFocusTuning,
  buildVideoConstraints,
  orderCamerasForSwitch,
  pickBackCamera,
  selectBackCamera,
  videoConstraintAttempts,
} from "./cameraSelect";

const iphone = [
  { id: "wide", label: "Back Camera" },
  { id: "ultra", label: "Back Ultra Wide Camera" },
  { id: "dual", label: "Back Dual Wide Camera" },
  { id: "triple", label: "Back Triple Camera" },
  { id: "front", label: "Front Camera" },
];

const android = [
  { id: "0", label: "camera2 0, facing back" },
  { id: "1", label: "camera2 1, facing front" },
  { id: "2", label: "camera2 2, facing back" },
  { id: "3", label: "camera2 3, facing back" },
];

describe("pickBackCamera", () => {
  test("iPhone etiketinde sanal ana kamerayı seçer, ultra-wide seçmez", () => {
    const picked = pickBackCamera(iphone);
    expect(["Back Triple Camera", "Back Dual Wide Camera", "Back Camera"]).toContain(picked.label);
    expect(picked.label).toBe("Back Triple Camera");
    expect(picked.label.toLowerCase()).not.toContain("ultra");
    expect(picked.id).not.toBe("front");
  });

  test("Android etiketinde camera2 0, facing back seçilir", () => {
    expect(pickBackCamera(android).label).toBe("camera2 0, facing back");
    expect(pickBackCamera(android).id).toBe("0");
  });

  test("boş etiketlerde null döner", () => {
    expect(pickBackCamera([])).toBeNull();
    expect(pickBackCamera(null)).toBeNull();
    expect(pickBackCamera([{ id: "a", label: "" }, { id: "b", label: "  " }])).toBeNull();
  });

  test("ön kamera varsayılan seçilmez", () => {
    expect(pickBackCamera([{ id: "f", label: "Front Camera" }])).toBeNull();
  });

  test("kamera değiştirirken ön kamera en sondadır", () => {
    const ordered = orderCamerasForSwitch(android);
    expect(ordered[0].label).toBe("camera2 0, facing back");
    expect(ordered[ordered.length - 1].label).toMatch(/front/);
    expect(ordered.map((device) => device.id)).toEqual(["0", "2", "3", "1"]);
  });
});

describe("buildVideoConstraints", () => {
  test("1920x1080 ideal içerir, min içermez; deviceId varken exact kullanılır", () => {
    const constraints = buildVideoConstraints();
    expect(constraints.width).toEqual({ ideal: 1920 });
    expect(constraints.height).toEqual({ ideal: 1080 });
    expect(JSON.stringify(constraints)).not.toContain("min");
    expect(constraints.deviceId).toBeUndefined();
    expect(constraints.facingMode).toEqual({ ideal: "environment" });

    const exact = buildVideoConstraints("cam-1");
    expect(exact.deviceId).toEqual({ exact: "cam-1" });
    expect(exact.width.ideal).toBe(1920);
    expect(exact.height.ideal).toBe(1080);
    expect(exact.facingMode).toBeUndefined();
    expect(JSON.stringify(exact)).not.toContain("min");
  });

  test("fallback zincirinde exact facingMode ve min yoktur", () => {
    const attempts = videoConstraintAttempts("cam-1");
    expect(attempts[0].width.ideal).toBe(1920);
    expect(attempts.some((item) => item === true)).toBe(true);
    attempts.forEach((item) => {
      if (!item || item === true) return;
      expect(JSON.stringify(item)).not.toContain("min");
      expect(item.facingMode?.exact).toBeUndefined();
    });
    const facingOnly = attempts.find((item) => item && item !== true && !item.width && item.facingMode);
    expect(facingOnly.facingMode).toEqual({ ideal: "environment" });
  });
});

describe("applyFocusTuning", () => {
  test("continuous focus ve zoom 1.5 uygular", async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined);
    const track = {
      getCapabilities: () => ({
        focusMode: ["continuous", "manual"],
        zoom: { min: 1, max: 8, step: 0.1 },
      }),
      applyConstraints,
    };
    await applyFocusTuning(track);
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: "continuous", zoom: 1.5 }],
    });
  });

  test("caps boşken hata fırlatmaz ve applyConstraints çağrılmaz", async () => {
    const applyConstraints = jest.fn();
    await expect(applyFocusTuning({
      getCapabilities: () => ({}),
      applyConstraints,
    })).resolves.toEqual({});
    expect(applyConstraints).not.toHaveBeenCalled();
    await expect(applyFocusTuning(null)).resolves.toEqual({});
    await expect(applyFocusTuning({
      getCapabilities: () => { throw new Error("yok"); },
      applyConstraints,
    })).resolves.toEqual({});
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  test("zoom.max 1.5'ten küçükse max kullanılır", async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined);
    await applyFocusTuning({
      getCapabilities: () => ({ zoom: { min: 1, max: 1.2, step: 0.1 } }),
      applyConstraints,
    });
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: 1.2 }],
    });
  });

  test("zoom 1'in altına inmez", async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined);
    await applyFocusTuning({
      getCapabilities: () => ({
        focusMode: ["continuous"],
        zoom: { min: 0.5, max: 8, step: 0.1 },
      }),
      applyConstraints,
    });
    expect(applyConstraints).toHaveBeenCalledWith({
      advanced: [expect.objectContaining({ zoom: 1.5, focusMode: "continuous" })],
    });
  });
});

describe("selectBackCamera", () => {
  test("continuous focus olan adayı en fazla 3 denemede seçer ve akışı kapatır", async () => {
    const stops = [];
    const opened = [];
    const getUserMedia = jest.fn(async ({ video }) => {
      const id = video.deviceId.exact;
      opened.push(id);
      const track = {
        getCapabilities: () => ({ focusMode: id === "2" ? ["continuous"] : ["manual"] }),
        stop: () => stops.push(id),
      };
      return {
        getVideoTracks: () => [track],
        getTracks: () => [track],
      };
    });
    const picked = await selectBackCamera(android, getUserMedia);
    expect(picked.id).toBe("2");
    expect(opened).toEqual(["0", "2"]);
    expect(opened.length).toBeLessThanOrEqual(3);
    expect(stops).toEqual(["0", "2"]);
  });
});
