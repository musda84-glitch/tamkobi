/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ContactRow } from "./ContactRow";

jest.mock("./ContactLocationModal", () => ({ mapsLink: () => "" }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/money", () => ({ formatTrAmount: (n) => String(n) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

test("cari satırında Link ve PDF yok; Ekstre kalır", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ContactRow
        contact={{ tax_number_or_id: "11111111111", name: "Demo", type: "customer", balance: 0 }}
        onOpen={() => {}}
        onMessage={() => {}}
        onStatement={() => {}}
        onLocation={() => {}}
      />,
    );
  });
  expect(host.querySelector('[data-testid="statement-link-btn-11111111111"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-pdf-btn-11111111111"]')).toBeNull();
  expect(host.querySelector('[data-testid="statement-btn-11111111111"]')).not.toBeNull();
  await act(async () => { root.unmount(); });
});
