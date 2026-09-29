import { absolutizeLabelUrl, embedLabelHtmlImages } from "./labelMedia";
import { qrSvg } from "./qrSvg";

describe("labelMedia", () => {
  it("absolutizes relative file paths with media base", () => {
    expect(absolutizeLabelUrl("/api/files/a.jpg", "https://tamkobi.com")).toBe("https://tamkobi.com/api/files/a.jpg");
    expect(absolutizeLabelUrl("https://cdn/x.png", "https://tamkobi.com")).toBe("https://cdn/x.png");
    expect(absolutizeLabelUrl("data:image/png;base64,xx")).toBe("data:image/png;base64,xx");
  });

  it("leaves html without images unchanged", async () => {
    const html = "<div>no img</div>";
    expect(await embedLabelHtmlImages(html, "https://tamkobi.com")).toBe(html);
  });
});

describe("qrSvg", () => {
  it("builds a crisp QR svg for a barcode", () => {
    const svg = qrSvg("8690001928371", 64);
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0');
    expect(svg).toContain("shape-rendering=\"crispEdges\"");
    expect(svg).toContain('fill="#000"');
  });

  it("shows placeholder when code is empty", () => {
    expect(qrSvg("")).toContain("QR yok");
  });
});
