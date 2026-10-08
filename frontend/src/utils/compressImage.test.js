import { compressProductImageFile } from "./compressImage";

function _fakeFile(name, type, size = 80 * 1024) {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 17) % 255;
  return new File([buf], name, { type, lastModified: Date.now() });
}

describe("compressProductImageFile", () => {
  test("passes through gif/heic unchanged", async () => {
    const gif = _fakeFile("a.gif", "image/gif", 12_000);
    expect(await compressProductImageFile(gif)).toBe(gif);
    const heic = _fakeFile("a.heic", "image/heic", 90_000);
    expect(await compressProductImageFile(heic)).toBe(heic);
  });

  test("non-image left alone", async () => {
    const pdf = _fakeFile("a.pdf", "application/pdf", 40_000);
    expect(await compressProductImageFile(pdf)).toBe(pdf);
  });
});
