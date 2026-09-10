
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PanelBoundary } from "./PanelBoundary";

const Boom = () => { throw new Error("kota listesi okunamadı"); };

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  // React ve sınırın kendisi yakalanan hatayı konsola yazar; test çıktısını boğmasın.
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const render = (node) => {
  const root = createRoot(host);
  act(() => root.render(node));
  return root;
};

test("çizilebilen panel olduğu gibi görünür", () => {
  render(<PanelBoundary label="Kotalar"><p>kota tablosu</p></PanelBoundary>);
  expect(host.textContent).toContain("kota tablosu");
});

test("çizim hatası boş alan değil, sebebini yazan bir uyarı bırakır", () => {
  render(<PanelBoundary label="Kotalar"><Boom /></PanelBoundary>);
  expect(host.querySelector('[data-testid="panel-boundary-error"]')).not.toBeNull();
  expect(host.textContent).toContain("Kotalar bölümü açılamadı.");
  expect(host.textContent).toContain("kota listesi okunamadı");
  expect(host.textContent.trim()).not.toBe("");
});

test("bölüm adı yokken de bir şey söyler", () => {
  render(<PanelBoundary><Boom /></PanelBoundary>);
  expect(host.textContent).toContain("Bölüm açılamadı.");
});

test("tekrar dene hatayı temizler", () => {
  let explode = true;
  const Flaky = () => { if (explode) throw new Error("geçici"); return <p>artık çalışıyor</p>; };
  render(<PanelBoundary label="Kotalar"><Flaky /></PanelBoundary>);
  expect(host.textContent).toContain("Kotalar bölümü açılamadı.");
  explode = false;
  act(() => { host.querySelector('[data-testid="panel-boundary-retry"]').click(); });
  expect(host.textContent).toContain("artık çalışıyor");
});
