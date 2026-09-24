import {
  resizeActions,
  scaledSize,
  skipImageCompress,
  isHeicLike,
  uploadImageFileName,
  compressPickerAsset,
  UPLOAD_IMAGE,
} from "./compressUploadImage";

describe("scaledSize", () => {
  it("keeps images already within the edge", () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600, resized: false });
  });

  it("shrinks the long edge to 1600", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200, resized: true });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600, resized: true });
  });
});

describe("uploadImageFileName", () => {
  it("swaps extension to webp or jpg", () => {
    expect(uploadImageFileName("Keşif.HEIC", "image/webp")).toBe("Keşif.webp");
    expect(uploadImageFileName("shot.PNG", "image/jpeg")).toBe("shot.jpg");
    expect(uploadImageFileName("", "image/webp")).toBe("photo.webp");
  });
});

describe("skipImageCompress", () => {
  it("skips gif and tiny files, but converts heic", () => {
    expect(skipImageCompress("image/gif", 200_000)).toBe(true);
    expect(skipImageCompress("image/heic", 200_000)).toBe(false);
    expect(skipImageCompress("", 200_000, "IMG_1.HEIC")).toBe(false);
    expect(skipImageCompress("image/jpeg", 8_000)).toBe(true);
    expect(skipImageCompress("image/jpeg", 200_000)).toBe(false);
    expect(isHeicLike("image/heif", "shot.heif")).toBe(true);
  });
});

describe("resizeActions", () => {
  it("only emits resize when needed", () => {
    expect(resizeActions(800, 600)).toEqual([]);
    expect(resizeActions(4000, 2000)).toEqual([{ resize: { width: UPLOAD_IMAGE.maxEdge } }]);
  });
});

describe("compressPickerAsset", () => {
  it("prefers webp and rewrites the filename", async () => {
    const manipulate = jest.fn(async (_uri: string, _a: unknown, format: string) =>
      format === "webp" ? { uri: "file:///cache/a.webp" } : { uri: "file:///cache/a.jpg" },
    );
    const out = await compressPickerAsset(
      { uri: "file:///orig.jpg", fileName: "villa.HEIC", mimeType: "image/jpeg", width: 4000, height: 3000, fileSize: 2_000_000 },
      manipulate,
    );
    expect(manipulate).toHaveBeenCalledWith("file:///orig.jpg", [{ resize: { width: 1600 } }], "webp");
    expect(out).toEqual({ uri: "file:///cache/a.webp", fileName: "villa.webp", mimeType: "image/webp" });
  });

  it("falls back to jpeg when webp encode fails", async () => {
    const manipulate = jest.fn(async (_uri: string, _a: unknown, format: string) => {
      if (format === "webp") throw new Error("no webp");
      return { uri: "file:///cache/a.jpg" };
    });
    const out = await compressPickerAsset(
      { uri: "file:///orig.jpg", fileName: "p.png", mimeType: "image/png", fileSize: 400_000 },
      manipulate,
    );
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.fileName).toBe("p.jpg");
  });

  it("leaves tiny or gif assets unchanged", async () => {
    const manipulate = jest.fn();
    const gif = { uri: "file:///a.gif", fileName: "a.gif", mimeType: "image/gif", fileSize: 90_000 };
    expect(await compressPickerAsset(gif, manipulate)).toEqual(gif);
    expect(manipulate).not.toHaveBeenCalled();
  });

  it("converts heic to jpeg first", async () => {
    const manipulate = jest.fn(async (_uri: string, _a: unknown, format: string) => {
      if (format === "jpeg") return { uri: "file:///cache/a.jpg" };
      return { uri: "file:///cache/a.webp" };
    });
    const out = await compressPickerAsset(
      { uri: "file:///orig.heic", fileName: "IMG_1.HEIC", mimeType: "image/heic", width: 4000, height: 3000, fileSize: 2_000_000 },
      manipulate,
    );
    expect(manipulate).toHaveBeenCalledWith("file:///orig.heic", [{ resize: { width: 1600 } }], "jpeg");
    expect(out).toEqual({ uri: "file:///cache/a.jpg", fileName: "IMG_1.jpg", mimeType: "image/jpeg" });
  });
});
