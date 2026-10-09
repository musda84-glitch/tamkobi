import { mediaRef, orderLineListImageUrl, productGalleryUrls, productIdOf, productListImageUrl } from "./productImages";

describe("productImages", () => {
  test("mediaRef reads strings and object fields", () => {
    expect(mediaRef("")).toBe("");
    expect(mediaRef(null)).toBe("");
    expect(mediaRef(" /api/files/a.jpg ")).toBe("/api/files/a.jpg");
    expect(mediaRef({ url: "/x.jpg" })).toBe("/x.jpg");
    expect(mediaRef({ image_url: "/y.jpg" })).toBe("/y.jpg");
    expect(mediaRef({ thumbnail_url: "/t.jpg" })).toBe("/t.jpg");
  });

  test("gallery prefers images[] then cover", () => {
    expect(productGalleryUrls({})).toEqual([]);
    expect(productGalleryUrls({ image_url: "/c.jpg" })).toEqual(["/c.jpg"]);
    expect(productGalleryUrls({
      image_url: "/c.jpg",
      images: [{ url: "/a.jpg" }, "", { image_url: "/b.jpg" }],
    })).toEqual(["/a.jpg", "/b.jpg"]);
  });

  test("productIdOf", () => {
    expect(productIdOf({ id: "p1" })).toBe("p1");
    expect(productIdOf({ _id: "p2" })).toBe("p2");
    expect(productIdOf(null)).toBe("");
  });

  test("productListImageUrl prefers thumbnail", () => {
    expect(productListImageUrl({ thumbnail_url: "/t.webp", image_url: "/full.jpg" })).toBe("/t.webp");
    expect(productListImageUrl({ image_url: "/full.jpg" })).toBe("/full.jpg");
    expect(productListImageUrl({ images: ["/a.jpg"] })).toBe("/a.jpg");
    expect(productListImageUrl({})).toBe("");
  });

  test("orderLineListImageUrl prefers line media over stock card", () => {
    expect(orderLineListImageUrl({ image_url: "/line.jpg" }, { thumbnail_url: "/t.webp" })).toBe("/line.jpg");
    expect(orderLineListImageUrl({ thumbnail_url: "/line-t.webp", image_url: "/line.jpg" }, { thumbnail_url: "/t.webp" })).toBe("/line-t.webp");
    expect(orderLineListImageUrl({}, { thumbnail_url: "/t.webp", image_url: "/full.jpg" })).toBe("/t.webp");
    expect(orderLineListImageUrl({}, { image_url: "/full.jpg" })).toBe("/full.jpg");
  });
});
