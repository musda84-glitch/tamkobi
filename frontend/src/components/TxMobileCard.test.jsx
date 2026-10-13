/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ClampExpandText, TX_NO_OVERFLOW_CLASS, TX_WRAP_CLASS, TxMobileCard, TxResponsiveList } from "./TxMobileCard";
import { txMobileListGuards } from "../utils/txMobileOverflow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "375px";
  host.style.maxWidth = "375px";
  document.body.appendChild(host);
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

const LONG = `VadesizTLHesabiBankaHareketi${"X".repeat(180)} aciklama sonu`;

function assert375NoOverflow(root) {
  expect(txMobileListGuards(root)).toEqual({ ok: true, reason: "" });
  const tableWrap = root.querySelector("[data-testid$='-wrap']");
  expect(tableWrap?.className || "").toMatch(/hidden md:block/);
}

test("ClampExpandText clamps to 2 lines and Devamı expands", () => {
  render(<ClampExpandText text={LONG} testId="clamp" forceMore />);
  const body = host.querySelector('[data-testid="clamp-body"]');
  expect(body.className).toMatch(/line-clamp-2/);
  const more = host.querySelector('[data-testid="clamp-more"]');
  expect(more.textContent).toBe("Devamı");
  act(() => more.click());
  expect(host.querySelector('[data-testid="clamp-more"]').textContent).toBe("Kısalt");
  expect(host.querySelector('[data-testid="clamp-body"]').className).not.toMatch(/line-clamp-2/);
});

test("TxMobileCard at 375px wraps long description and keeps amount/actions", () => {
  render(
    <div style={{ width: 375 }}>
      <TxResponsiveList
        cardsTestId="demo-cards"
        tableWrapTestId="demo-table-wrap"
        cards={(
          <TxMobileCard
            testId="demo-card"
            date="13.10.2026"
            party="Ali Yılmaz"
            badge={<span>Giriş</span>}
            amount="+1.250,00 ₺"
            description={LONG}
            actions={<button type="button">Sil</button>}
          />
        )}
        table={<table data-testid="demo-table"><tbody><tr><td>desk</td></tr></tbody></table>}
      />
    </div>,
  );
  assert375NoOverflow(host);
  expect(host.querySelector('[data-testid="demo-card"]').textContent).toContain("Ali Yılmaz");
  expect(host.querySelector('[data-testid="demo-card"]').textContent).toContain("1.250,00");
  expect(host.querySelector('[data-testid="demo-card"]').textContent).toContain("Sil");
  expect(host.querySelector('[data-testid="demo-table"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="demo-table-wrap"]').className).toMatch(/hidden md:block/);
  expect(TX_WRAP_CLASS).toMatch(/break-words/);
  expect(TX_NO_OVERFLOW_CLASS).toMatch(/overflow-x-hidden/);
});
