import {
  appendUploadBlob,
  imageUploadRequest,
  lineItemImageUploadRequest,
  imageUploaderCopy,
  removeGalleryImage,
  isExpoFetchFilePart,
  pickBrowserImage,
  pickBrowserImages,
  pickBrowserReceipt,
  pickerFileMeta,
  resolveUploadBlob,
  uploadedImageUrl,
} from "./formDataFile";

describe("pickBrowserImage", () => {
  it("opens a file input and returns the chosen image", async () => {
    const file = { name: "koltuk.jpg", type: "image/jpeg" } as File;
    const input = {
      type: "",
      accept: "",
      multiple: true,
      files: [file],
      onchange: null as (() => void) | null,
      click() {
        this.onchange?.();
      },
    };
    const picked = await pickBrowserImage(() => input as unknown as HTMLInputElement);
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(picked?.fileName).toBe("koltuk.jpg");
    expect(picked?.file).toBe(file);
    expect(input.multiple).toBe(false);
  });

  it("lets the gallery input choose several images", async () => {
    const a = { name: "a.jpg", type: "image/jpeg" } as File;
    const b = { name: "b.jpg", type: "image/jpeg" } as File;
    const input = {
      type: "",
      accept: "",
      multiple: false,
      files: [a, b],
      onchange: null as (() => void) | null,
      click() {
        this.onchange?.();
      },
    };
    const picked = await pickBrowserImages(() => input as unknown as HTMLInputElement);
    expect(input.multiple).toBe(true);
    expect(picked.map((x) => x.fileName)).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("pickBrowserReceipt", () => {
  it("opens the camera capture input", async () => {
    const file = { name: "shot.jpg", type: "image/jpeg" } as File;
    const attrs: Record<string, string> = {};
    const input = {
      type: "",
      accept: "",
      multiple: true,
      files: [file],
      onchange: null as (() => void) | null,
      setAttribute(name: string, value: string) { attrs[name] = value; },
      click() { this.onchange?.(); },
    };
    const picked = await pickBrowserReceipt("camera", () => input as unknown as HTMLInputElement);
    expect(input.accept).toBe("image/*");
    expect(attrs.capture).toBe("environment");
    expect(picked?.fileName).toBe("shot.jpg");
  });
});

describe("isExpoFetchFilePart", () => {
  it("rejects RN {uri,name,type} that Expo fetch throws on", () => {
    expect(isExpoFetchFilePart({ uri: "file:///p.jpg", name: "p.jpg", type: "image/jpeg" })).toBe(false);
  });

  it("accepts Blob and expo-file-system {bytes()}", () => {
    expect(isExpoFetchFilePart({ size: 2, arrayBuffer: async () => new ArrayBuffer(2) })).toBe(true);
    expect(isExpoFetchFilePart({ bytes: async () => new Uint8Array([1, 2]) })).toBe(true);
  });
});

describe("resolveUploadBlob", () => {
  const file = { size: 4, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Blob;

  it("uses asset.file when Expo fetch can send it", async () => {
    const got = await resolveUploadBlob({ uri: "file:///x", fileName: "cam.jpg", file });
    expect(got).toEqual({ blob: file, name: "cam.jpg" });
  });

  it("reads uri through the file reader on native assets", async () => {
    const blob = { size: 8 } as Blob;
    const readFile = jest.fn(async () => blob);
    const got = await resolveUploadBlob(
      { uri: "file:///data/user/0/photo.jpg", fileName: "shot.jpg" },
      readFile,
    );
    expect(readFile).toHaveBeenCalledWith("file:///data/user/0/photo.jpg");
    expect(got).toEqual({ blob, name: "shot.jpg" });
  });

  it("rejects missing uri when there is no usable file", async () => {
    await expect(resolveUploadBlob({})).rejects.toThrow(/URI/);
  });
});

describe("appendUploadBlob", () => {
  it("appends Blob with filename, never a uri part", () => {
    const blob = { size: 1 } as Blob;
    const form = { append: jest.fn() } as unknown as FormData;
    appendUploadBlob(form, blob, "p.jpg");
    expect(form.append).toHaveBeenCalledWith("file", blob, "p.jpg");
    expect(form.append).not.toHaveBeenCalledWith("file", expect.objectContaining({ uri: expect.anything() }));
  });
});

describe("pickerFileMeta and upload target", () => {
  it("defaults jpeg name/type", () => {
    expect(pickerFileMeta({ uri: "content://media/1" })).toEqual({
      name: "photo.jpg",
      type: "image/jpeg",
      uri: "content://media/1",
    });
  });

  it("posts products to /products/:id/image", () => {
    expect(imageUploadRequest("product", "prod_1")).toEqual({
      path: "/products/prod_1/image",
      query: undefined,
    });
  });

  it("uploads a line photo without attaching it to the quote gallery", () => {
    expect(lineItemImageUploadRequest("c1")).toEqual({
      path: "/files/upload",
      query: { entity: "product", entity_id: "", company_id: "c1" },
    });
  });

  it("posts quote/project/survey to /files/upload", () => {
    expect(imageUploadRequest("survey", "s1", "c1")).toEqual({
      path: "/files/upload",
      query: { entity: "survey", entity_id: "s1", company_id: "c1" },
    });
    expect(imageUploadRequest("quote", "q1", "c1").query?.entity).toBe("quote");
    expect(imageUploadRequest("project", "p1", "c1").query?.entity).toBe("project");
    expect(imageUploadRequest("project", "p1", "c1", { stage: "active", stage_label: "Devam Ediyor" }).query).toEqual({
      entity: "project",
      entity_id: "p1",
      company_id: "c1",
      stage: "active",
      stage_label: "Devam Ediyor",
    });
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
    expect(imageUploaderCopy("partner").label).toMatch(/Ortak/);
    expect(removeGalleryImage(["/a.jpg", "/b.jpg", "/a.jpg"], "/a.jpg")).toEqual(["/b.jpg"]);
    expect(removeGalleryImage(["/a.jpg"], "/missing.jpg")).toEqual(["/a.jpg"]);
    expect(removeGalleryImage(null, "/a.jpg")).toEqual([]);
    expect(imageUploadRequest("partner", "ort1", "c1")).toEqual({
      path: "/files/upload",
      query: { entity: "partner_photo", entity_id: "ort1", company_id: "c1" },
    });
    expect(imageUploaderCopy("employee").label).toMatch(/Personel/);
    expect(imageUploadRequest("employee", "e1", "c1")).toEqual({
      path: "/files/upload",
      query: { entity: "employee_photo", entity_id: "e1", company_id: "c1" },
    });
  });
});
