import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...rest }) => (
    <button type="button" disabled={!!disabled} onClick={() => !disabled && onSelect?.()} {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuSubContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
}));

import { ProjectActionsMenu } from "./ProjectActionsMenu";

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) act(() => { root.unmount(); });
  root = null;
  host.remove();
});

function renderMenu(quotes, extra = {}) {
  const props = {
    project: { id: "p1", project_number: "PRJ-1", name: "Cephe" },
    quotes,
    onEdit: jest.fn(),
    onPrintQuote: jest.fn(),
    onExpense: jest.fn(),
    onTeam: jest.fn(),
    onTrack: jest.fn(),
    onOpenDetail: jest.fn(),
    onDelete: jest.fn(),
    ...extra,
  };
  if (root) act(() => { root.unmount(); });
  root = createRoot(host);
  act(() => { root.render(<ProjectActionsMenu {...props} />); });
  return props;
}

test("menüdeki tüm işlemler ve mevcut testid'ler durur", () => {
  renderMenu([]);
  const text = host.textContent;
  ["Proje Düzenle", "Teklif Yazdır", "Masraf Ekle", "Personel / Görev", "Takip Linki gönder", "Detay / tüm fotoğraflar", "Projeyi sil"].forEach((label) => {
    expect(text).toContain(label);
  });
  expect(host.querySelector('[data-testid="project-more-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-edit-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-expense-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-team-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-track-PRJ-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-print-quote-PRJ-1"]')).toBeTruthy();
});

test("teklif yoksa yazdır pasif, tek teklif doğrudan açılır, iki teklifte alt menü vardır", () => {
  const none = renderMenu([]);
  const print = host.querySelector('[data-testid="project-print-quote-PRJ-1"]');
  expect(print.disabled).toBe(true);
  expect(print.textContent).toContain("Bu projede yazdırılacak teklif yok");
  act(() => { print.click(); });
  expect(none.onPrintQuote).not.toHaveBeenCalled();

  const one = { id: "q1", quote_number: "TKL-1", title: "Cephe" };
  const single = renderMenu([one]);
  act(() => { host.querySelector('[data-testid="project-print-quote-PRJ-1"]').click(); });
  expect(single.onPrintQuote).toHaveBeenCalledWith(one);
  expect(host.querySelector('[data-testid="project-print-quote-menu-PRJ-1"]')).toBeNull();

  const quotes = [
    { id: "q1", quote_number: "TKL-1", title: "Bir" },
    { id: "q2", quote_number: "TKL-2", title: "İki" },
  ];
  const multi = renderMenu(quotes);
  expect(host.querySelector('[data-testid="project-print-quote-menu-PRJ-1"]')).toBeTruthy();
  act(() => { host.querySelector('[data-testid="project-print-quote-item-TKL-2"]').click(); });
  expect(multi.onPrintQuote).toHaveBeenCalledWith(quotes[1]);
});

test("sil del çağrısını yapar", () => {
  const del = jest.fn();
  renderMenu([], { onDelete: del });
  act(() => { host.querySelector('[data-testid="project-delete-PRJ-1"]').click(); });
  expect(del).toHaveBeenCalled();
});
