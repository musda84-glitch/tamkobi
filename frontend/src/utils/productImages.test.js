import { collectOrderThumbSrcs, mediaRef, orderLineListImageUrl, orderLineThumbSrc, productCardImageUrl, productGalleryUrls, productIdOf, productListImageUrl } from "./productImages";

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

  test("productCardImageUrl keeps the cover so the card can ask for 600px", () => {
    expect(productCardImageUrl({ thumbnail_url: "/t.w200.webp", image_url: "/full.jpg" })).toBe("/full.jpg");
    expect(productCardImageUrl({ thumbnail_url: "/t.webp" })).toBe("/t.webp");
    expect(productCardImageUrl({})).toBe("");
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

  test("order list and opened order share one 200px file url", () => {
    const line = { image_url: "/api/files/tamkobi/products/a.jpg" };
    const closed = orderLineThumbSrc(line, null);
    const opened = orderLineThumbSrc(line, { thumbnail_url: "/api/files/tamkobi/products/a.w200.webp" });
    expect(closed).toBe("/api/files/tamkobi/products/a.jpg?w=200");
    expect(opened).toBe(closed);
    const orders = [{
      items: [
        line,
        { image_url: "/api/files/tamkobi/products/b.jpg" },
        { image_url: "/api/files/tamkobi/products/a.jpg" },
        { product_id: "p9" },
      ],
    }];
    const resolve = (it) => (it.product_id === "p9" ? { thumbnail_url: "/api/files/tamkobi/products/c.w200.webp" } : null);
    expect(collectOrderThumbSrcs(orders, resolve, 2)).toEqual([
      "/api/files/tamkobi/products/a.jpg?w=200",
      "/api/files/tamkobi/products/b.jpg?w=200",
    ]);
    expect(collectOrderThumbSrcs(orders, resolve, null)).toEqual([
      "/api/files/tamkobi/products/a.jpg?w=200",
      "/api/files/tamkobi/products/b.jpg?w=200",
      "/api/files/tamkobi/products/c.w200.webp",
    ]);
  });
});
