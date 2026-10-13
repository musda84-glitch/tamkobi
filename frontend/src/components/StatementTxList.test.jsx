/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { StatementTxList } from "./StatementTxList";
import { txMobileListGuards } from "../utils/txMobileOverflow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  host.style.width = "375px";
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

test("cari ekstre 375px kartlarında belge açıklaması kırılır, masaüstü tablo durur", () => {
  const rows = [
    {
      kind: "invoice",
      date: "2026-10-01",
      doc: `FAT-2026-0001 ${"UzunBelgeAciklamasi".repeat(20)}`,
      debit: 15000,
      credit: 0,
      balance: 15000,
    },
    {
      kind: "payment",
      date: "2026-10-05",
      doc: "Tahsilat",
      debit: 0,
      credit: 4000,
      balance: 11000,
    },
  ];
  const root = createRoot(host);
  act(() => root.render(<StatementTxList rows={rows} tableTestId="statement-table" showKindDot />));
  expect(txMobileListGuards(host)).toEqual({ ok: true, reason: "" });
  expect(host.querySelector('[data-testid="statement-table-cards"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="statement-table"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="statement-table-cards"]').textContent).toMatch(/Borç|Alacak/);
  expect(host.querySelector('[data-testid="statement-table-cards"]').textContent).toMatch(/15/);
});
