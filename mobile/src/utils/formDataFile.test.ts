import {
  appendPickerAsset,
  imageUploadRequest,
  imageUploaderCopy,
  isWebFormFile,
  pickerFormPart,
  uploadedImageUrl,
} from "./formDataFile";

describe("pickerFormPart", () => {
  const file = { size: 4 } as Blob;

  it("uses File on web when asset.file exists", () => {
    const part = pickerFormPart(
      { uri: "file:///tmp/cam.jpg", fileName: "cam.jpg", mimeType: "image/jpeg", file },
      "web",
    );
    expect(isWebFormFile(part)).toBe(true);
    expect(part).toEqual({ file, name: "cam.jpg" });
  });

  it("never sends File/Blob on native even if asset.file is set", () => {
    const part = pickerFormPart(
      { uri: "file:///data/user/0/photo.jpg", fileName: "shot.jpg", mimeType: "image/jpeg", file },
      "android",
    );
    expect(isWebFormFile(part)).toBe(false);
    expect(part).toEqual({
      uri: "file:///data/user/0/photo.jpg",
      name: "shot.jpg",
      type: "image/jpeg",
    });
  });

  it("falls back to jpeg name/type and rejects missing uri on native", () => {
    expect(pickerFormPart({ uri: "content://media/1" }, "ios")).toEqual({
      uri: "content://media/1",
      name: "photo.jpg",
      type: "image/jpeg",
    });
    expect(() => pickerFormPart({ file }, "android")).toThrow(/URI/);
  });
});

describe("appendPickerAsset", () => {
  it("appends native {uri,name,type} on android", () => {
    const form = { append: jest.fn() } as unknown as FormData;
    appendPickerAsset(form, { uri: "file:///p.jpg", fileName: "p.jpg", mimeType: "image/jpeg", file: {} as Blob }, "android");
    expect(form.append).toHaveBeenCalledWith("file", { uri: "file:///p.jpg", name: "p.jpg", type: "image/jpeg" });
  });

  it("appends Blob with filename on web", () => {
    const file = { size: 2 } as Blob;
    const form = { append: jest.fn() } as unknown as FormData;
    appendPickerAsset(form, { uri: "blob:1", fileName: "web.png", mimeType: "image/png", file }, "web");
    expect(form.append).toHaveBeenCalledWith("file", file, "web.png");
  });
});

describe("image upload target and result", () => {
  it("posts products to /products/:id/image", () => {
    expect(imageUploadRequest("product", "prod_1")).toEqual({
      path: "/products/prod_1/image",
      query: undefined,
    });
  });

  it("posts quote/project/survey to /files/upload", () => {
    expect(imageUploadRequest("survey", "s1", "c1")).toEqual({
      path: "/files/upload",
      query: { entity: "survey", entity_id: "s1", company_id: "c1" },
    });
    expect(imageUploadRequest("quote", "q1", "c1").query?.entity).toBe("quote");
    expect(imageUploadRequest("project", "p1", "c1").query?.entity).toBe("project");
  });

  it("reads url from files/upload and product image responses", () => {
    expect(uploadedImageUrl({ url: "/api/files/a.jpg" })).toBe("/api/files/a.jpg");
    expect(uploadedImageUrl({ image_url: "/api/files/b.jpg" })).toBe("/api/files/b.jpg");
    expect(uploadedImageUrl({ product: { image_url: "/api/files/c.jpg" } })).toBe("/api/files/c.jpg");
    expect(uploadedImageUrl({})).toBe("");
  });

  it("labels photo cards", () => {
    expect(imageUploaderCopy("survey").label).toMatch(/Keşif/);
    expect(imageUploaderCopy("quote").label).toMatch(/Teklif/);
    expect(imageUploaderCopy("project").label).toMatch(/Proje/);
    expect(imageUploaderCopy("product").label).toMatch(/Stok/);
  });
});
