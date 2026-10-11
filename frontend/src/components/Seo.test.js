import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { readFileSync } from "fs";
import { join } from "path";
import { HelmetProvider } from "react-helmet-async";
import { Seo, defaultSeoDescription } from "./Seo";
import { stripStaticRhTags } from "../stripStaticRhTags";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INDEX_HTML = readFileSync(join(__dirname, "../../public/index.html"), "utf8");

function loadIndexHead() {
  const parsed = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  document.head.innerHTML = "";
  [...parsed.head.childNodes].forEach((n) => {
    document.head.appendChild(document.importNode(n, true));
  });
}

async function renderSeo(props) {
  HelmetProvider.canUseDOM = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HelmetProvider>
        <Seo {...props} />
      </HelmetProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return {
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

test("defaultSeoDescription uses trial_days", () => {
  expect(defaultSeoDescription(21)).toContain("21 gün");
  expect(defaultSeoDescription(21)).not.toContain("14 gün");
  expect(defaultSeoDescription(0)).toContain("14 gün");
});

test("index.html keeps static data-rh defaults without canonical/og:url", () => {
  expect((INDEX_HTML.match(/rel="canonical"/g) || []).length).toBe(0);
  expect(INDEX_HTML).not.toContain('property="og:url"');
  expect(INDEX_HTML).toContain('data-rh="true"');
  expect(INDEX_HTML).toContain("og:title");
  expect(INDEX_HTML).toContain("og:description");
  expect(INDEX_HTML).toContain("og:image");
  expect(INDEX_HTML).toContain("og:locale");
  expect(INDEX_HTML).toContain("twitter:card");
  expect(INDEX_HTML).toContain("KOBİ'ler için Bulut ERP ve e-Fatura Programı | TamKobi");
});

describe.each([
  {
    path: "/",
    props: {
      title: "KOBİ'ler için Bulut ERP ve e-Fatura Programı | TamKobi",
      path: "/",
      trialDays: 14,
    },
  },
  {
    path: "/kayit",
    props: {
      title: "Ücretsiz Deneme Kaydı | TamKobi",
      path: "/kayit",
      trialDays: 14,
      description: "TamKobi bulut ERP'yi 14 gün ücretsiz deneyin. Kredi kartı gerekmez.",
    },
  },
  {
    path: "/yasal/kvkk",
    props: {
      title: "KVKK Aydınlatma Metni | TamKobi",
      path: "/yasal/kvkk",
      description: "TamKobi KVKK aydınlatma metni — kişisel verilerin işlenmesi, saklanması ve haklarınız.",
    },
  },
])("after stripStaticRhTags + Seo for $path", ({ path, props }) => {
  test("exactly one canonical and one description", async () => {
    loadIndexHead();
    // Üretimle aynı: index.js render öncesi strip
    stripStaticRhTags();
    expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(0);

    const { cleanup } = await renderSeo(props);

    const links = document.head.querySelectorAll('link[rel="canonical"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toMatch(new RegExp(`${path === "/" ? "/$" : `${path}$`}`));

    const descs = document.head.querySelectorAll('meta[name="description"]');
    expect(descs).toHaveLength(1);
    expect(descs[0].getAttribute("content")).toBeTruthy();

    await cleanup();
  });
});
