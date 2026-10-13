import { txMobileListGuards } from "./txMobileOverflow";

test("375px guards fail when a table sits in the mobile list", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div data-tx-mobile-list class="md:hidden overflow-x-hidden max-w-full"><table></table></div>`;
  expect(txMobileListGuards(root).ok).toBe(false);
});

test("375px guards pass wrapped cards without a table", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div data-tx-mobile-list class="md:hidden overflow-x-hidden max-w-full min-w-0"><div data-tx-wrap class="min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word]">x</div></div>`;
  expect(txMobileListGuards(root)).toEqual({ ok: true, reason: "" });
});
