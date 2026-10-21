/**
 * @jest-environment jsdom
 */
import {
  getHostKind,
  hostUrl,
  pathAllowedOnHost,
  preferredHostForPath,
  applyRobotsMeta,
  ROOT_DOMAIN,
  YNT_HOST,
  yntRedirectEnabled,
} from "./hosts";

function fakeWin(hostname, pathname = "/", search = "") {
  return {
    location: {
      hostname,
      pathname,
      search,
      protocol: "https:",
      href: `https://${hostname}${pathname}${search}`,
    },
  };
}

describe("getHostKind", () => {
  test("maps production hosts", () => {
    expect(getHostKind(fakeWin("tamkobi.com"))).toBe("site");
    expect(getHostKind(fakeWin("www.tamkobi.com"))).toBe("site");
    expect(getHostKind(fakeWin("app.tamkobi.com"))).toBe("app");
    expect(getHostKind(fakeWin("b2b.tamkobi.com"))).toBe("b2b");
    expect(getHostKind(fakeWin("ik.tamkobi.com"))).toBe("ik");
    expect(getHostKind(fakeWin("ynt.taiyazilim.com"))).toBe("ynt");
    expect(getHostKind(fakeWin(YNT_HOST))).toBe("ynt");
    expect(getHostKind(fakeWin("taiyazilim.com"))).toBe("site");
    expect(getHostKind(fakeWin("www.taiyazilim.com"))).toBe("site");
  });

  test("localhost __host override", () => {
    expect(getHostKind(fakeWin("localhost", "/", "?__host=app"))).toBe("app");
    expect(getHostKind(fakeWin("127.0.0.1", "/", "?__host=ik"))).toBe("ik");
    expect(getHostKind(fakeWin("localhost", "/", "?__host=b2b"))).toBe("b2b");
    expect(getHostKind(fakeWin("localhost", "/", "?__host=ynt"))).toBe("ynt");
  });

  test("ignores __host on production host", () => {
    expect(getHostKind(fakeWin("app.tamkobi.com", "/", "?__host=site"))).toBe("app");
  });
});

describe("hostUrl", () => {
  test("builds https URLs for kinds when not on localhost", () => {
    const loc = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "app.tamkobi.com",
        protocol: "https:",
        pathname: "/",
        search: "",
        href: "https://app.tamkobi.com/",
      },
    });
    expect(hostUrl("app", "/panel")).toBe(`https://app.${ROOT_DOMAIN}/panel`);
    expect(hostUrl("b2b", "/b2b/giris")).toBe(`https://b2b.${ROOT_DOMAIN}/b2b/giris`);
    expect(hostUrl("ik", "/personelim")).toBe(`https://ik.${ROOT_DOMAIN}/personelim`);
    expect(hostUrl("site", "/sistem")).toBe(`https://${ROOT_DOMAIN}/sistem`);
    expect(hostUrl("ynt", "/sistem")).toBe(`https://${YNT_HOST}/sistem`);
    Object.defineProperty(window, "location", { configurable: true, value: loc });
  });
});

describe("pathAllowedOnHost / preferredHostForPath", () => {
  test("sistem on site and ynt", () => {
    expect(pathAllowedOnHost("/sistem/giris", "site")).toBe(true);
    expect(pathAllowedOnHost("/sistem/giris", "ynt")).toBe(true);
    expect(pathAllowedOnHost("/sistem/giris", "app")).toBe(false);
    expect(preferredHostForPath("/sistem/web")).toBe("site");
    expect(yntRedirectEnabled()).toBe(false);
  });

  test("panel routes belong on app", () => {
    expect(pathAllowedOnHost("/invoices", "app")).toBe(true);
    expect(pathAllowedOnHost("/yardim", "app")).toBe(true);
    expect(pathAllowedOnHost("/panel", "site")).toBe(false);
    expect(preferredHostForPath("/invoices")).toBe("app");
    expect(preferredHostForPath("/login")).toBe("app");
  });

  test("b2b and ik paths", () => {
    expect(preferredHostForPath("/portal/abc")).toBe("b2b");
    expect(preferredHostForPath("/b2b/giris")).toBe("b2b");
    expect(preferredHostForPath("/b2b/tedarikci")).toBe("b2b");
    expect(pathAllowedOnHost("/b2b/tedarikci", "b2b")).toBe(true);
    expect(preferredHostForPath("/personelim")).toBe("ik");
    expect(preferredHostForPath("/mesai")).toBe("ik");
    expect(preferredHostForPath("/hakkimizda")).toBe("site");
    expect(preferredHostForPath("/iletisim")).toBe("site");
    expect(pathAllowedOnHost("/hizmetler", "site")).toBe(true);
    expect(pathAllowedOnHost("/referanslar", "site")).toBe(true);
    expect(pathAllowedOnHost("/personelim", "ik")).toBe(true);
    expect(pathAllowedOnHost("/personelim", "app")).toBe(false);
    expect(pathAllowedOnHost("/atolye", "ik")).toBe(true);
    expect(pathAllowedOnHost("/sevk", "ik")).toBe(true);
    expect(pathAllowedOnHost("/sayim", "ik")).toBe(true);
    expect(pathAllowedOnHost("/saha", "ik")).toBe(true);
  });
});

describe("applyRobotsMeta", () => {
  test("noindex on app/b2b/ik", () => {
    document.head.innerHTML = "";
    applyRobotsMeta("app");
    expect(document.querySelector('meta[name="robots"]').getAttribute("content")).toBe("noindex,nofollow");
    applyRobotsMeta("site");
    expect(document.querySelector('meta[name="robots"]').getAttribute("content")).toBe("index,follow");
  });
});
