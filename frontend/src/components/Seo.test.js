import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { readFileSync } from "fs";
import { join } from "path";
import { HelmetProvider } from "react-helmet-async";
import { Seo, defaultSeoDescription } from "./Seo";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("defaultSeoDescription uses trial_days", () => {
  expect(defaultSeoDescription(21)).toContain("21 gün");
  expect(defaultSeoDescription(21)).not.toContain("14 gün");
  expect(defaultSeoDescription(0)).toContain("14 gün");
});

test("index.html has single data-rh canonical and required defaults", () => {
  const html = readFileSync(join(__dirname, "../../public/index.html"), "utf8");
  expect((html.match(/rel="canonical"/g) || []).length).toBe(1);
  expect(html).toContain('data-rh="true"');
  expect(html).toContain('href="https://tamkobi.com/"');
  expect(html).toContain("og:title");
  expect(html).toContain("og:description");
  expect(html).toContain("og:image");
  expect(html).toContain("og:url");
  expect(html).toContain("og:locale");
  expect(html).toContain("twitter:card");
  expect(html).toContain("KOBİ'ler için Bulut ERP ve e-Fatura Programı | TamKobi");
});

test("Seo renders one canonical and trial_days description", async () => {
  HelmetProvider.canUseDOM = true;
  document.head.querySelectorAll('link[rel="canonical"], meta[name="description"]').forEach((n) => n.remove());

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HelmetProvider>
        <Seo title="Test | TamKobi" path="/web" trialDays={21} />
      </HelmetProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });

  const links = [...document.head.querySelectorAll('link[rel="canonical"]')];
  expect(links.length).toBe(1);
  expect(links[0].getAttribute("href")).toMatch(/\/web$/);
  const descs = [...document.head.querySelectorAll('meta[name="description"]')];
  expect(descs.length).toBe(1);
  expect(descs[0].getAttribute("content")).toContain("21 gün");

  await act(async () => { root.unmount(); });
  host.remove();
});
