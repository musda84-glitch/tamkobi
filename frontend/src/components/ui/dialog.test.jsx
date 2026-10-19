/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

test("dialog içeriği telefonda ekrana sığar ve içeride kayar", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Başlık</DialogTitle>
          <DialogDescription>Açıklama</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
  });
  const dialog = document.body.querySelector("[role='dialog']");
  expect(dialog).toBeTruthy();
  expect(dialog.className).toContain("max-h-[90dvh]");
  expect(dialog.className).toContain("overflow-y-auto");
  expect(dialog.className).toContain("max-w-[calc(100vw-1rem)]");
  expect(dialog.className).toContain("sm:max-w-lg");
  expect(dialog.className).not.toMatch(/(^|\s)max-w-lg(\s|$)/);
  await act(async () => { root.unmount(); });
  host.remove();
});
