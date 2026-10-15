/**
 * @jest-environment jsdom
 */
import {
  DEFAULT_VITRIN_URL,
  VITRIN_PREVIEW_MESSAGE,
  announceVitrinPreview,
  classifyPreviewFrame,
  resolveVitrinPreviewUrl,
  vitrinChildUrl,
} from "./vitrinPreview";

function fakeWin(hostname, search = "") {
  return {
    location: {
      hostname,
      search,
      protocol: "https:",
      href: `https://${hostname}/${search}`,
      origin: `https://${hostname}`,
      pathname: "/",
    },
  };
}

describe("resolveVitrinPreviewUrl", () => {
  const ynt = fakeWin("ynt.taiyazilim.com");

  test("boş canlı adres varsayılan mutlak vitrindir, ynt origin kullanılmaz", () => {
    expect(resolveVitrinPreviewUrl("", ynt)).toBe(DEFAULT_VITRIN_URL);
    expect(resolveVitrinPreviewUrl(null, ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("   ", ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("", ynt)).not.toContain("ynt.taiyazilim.com");
  });

  test("ynt host'unda göreli adres iframe'e yazılmaz", () => {
    for (const raw of ["/", "/web", "web", "./web", "../web", "?x=1"]) {
      const url = resolveVitrinPreviewUrl(raw, ynt);
      expect(url).toBe("https://tamkobi.com");
      expect(url.startsWith("/")).toBe(false);
      expect(url).not.toContain("ynt.");
    }
  });

  test("canlı adres alanı mutlak URL olarak kullanılır", () => {
    expect(resolveVitrinPreviewUrl("https://magaza.example/vitrin/", ynt)).toBe("https://magaza.example/vitrin");
    expect(resolveVitrinPreviewUrl("https://tamkobi.com/", ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("tamkobi.com", ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("//vitrin.example/yol", ynt)).toBe("https://vitrin.example/yol");
  });

  test("ynt host'u canlı adres olsa da vitrine düşülür", () => {
    expect(resolveVitrinPreviewUrl("https://ynt.taiyazilim.com", ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("https://ynt.taiyazilim.com/web", fakeWin("app.tamkobi.com"))).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("https://YNT.taiyazilim.com/", ynt)).toBe("https://tamkobi.com");
  });

  test("javascript ve geçersiz şema reddedilir", () => {
    expect(resolveVitrinPreviewUrl("javascript:alert(1)", ynt)).toBe("https://tamkobi.com");
    expect(resolveVitrinPreviewUrl("data:text/html,hi", ynt)).toBe("https://tamkobi.com");
  });

  test("seçili sitenin yedek adresi boş ve ynt değerinde kullanılır", () => {
    const tai = "https://taiyazilim.com";
    expect(resolveVitrinPreviewUrl("", ynt, tai)).toBe(tai);
    expect(resolveVitrinPreviewUrl("/web", ynt, tai)).toBe(tai);
    expect(resolveVitrinPreviewUrl("https://ynt.taiyazilim.com", ynt, tai)).toBe(tai);
    expect(resolveVitrinPreviewUrl("https://taiyazilim.com/hakkimizda/", ynt, tai)).toBe("https://taiyazilim.com/hakkimizda");
    expect(vitrinChildUrl("", "/kayit", ynt, tai)).toBe("https://taiyazilim.com/kayit");
  });
});

describe("vitrinChildUrl", () => {
  test("kayıt sayfası ynt origin'ine çözülmez", () => {
    const url = vitrinChildUrl("https://magaza.example/", "/kayit", fakeWin("ynt.taiyazilim.com"));
    expect(url).toBe("https://magaza.example/kayit");
    expect(url).not.toContain("ynt.");
  });
});

describe("classifyPreviewFrame", () => {
  test("about:blank ve boş kabuk engel sayılır", () => {
    expect(classifyPreviewFrame(null)).toBe("blank");
    expect(classifyPreviewFrame({ contentWindow: { location: { href: "about:blank" }, document: { body: { innerText: "", childElementCount: 0 } } } })).toBe("blank");
    expect(classifyPreviewFrame({ contentWindow: { location: { href: "chrome-error://chromewebdata/" }, document: { body: { textContent: "", childElementCount: 0 } } } })).toBe("blank");
  });

  test("cross-origin SecurityError opak sayılır", () => {
    const frame = {
      contentWindow: {
        get location() {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    };
    expect(classifyPreviewFrame(frame)).toBe("opaque");
  });

  test("same-origin dolu belge okunabilir", () => {
    const frame = {
      contentWindow: {
        location: { href: "https://tamkobi.com/" },
        document: { body: { innerText: "TamKobi", childElementCount: 1 } },
      },
    };
    expect(classifyPreviewFrame(frame)).toBe("readable");
  });
});

describe("announceVitrinPreview", () => {
  test("yalnız iframe içindeyken hazır sinyali yollar", () => {
    const parent = { postMessage: jest.fn() };
    const child = { parent };
    announceVitrinPreview(child);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: VITRIN_PREVIEW_MESSAGE }, "*");

    const top = { postMessage: jest.fn() };
    top.parent = top;
    announceVitrinPreview(top);
    expect(top.postMessage).not.toHaveBeenCalled();
  });
});
