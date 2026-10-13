/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

jest.mock("../../context/HelpContext", () => {
  const state = {
    popoverOpen: false,
    openHelp: () => { state.popoverOpen = true; },
    closeHelp: () => { state.popoverOpen = false; },
    pageHelp: { title: "Faturalar", intro: "Satış faturaları.", pageKey: "/invoices", tour: [] },
    startTour: () => {},
    openHelpCenter: () => {},
    openWizard: () => {},
    articles: [{ slug: "fatura-nasil-kesilir", title: "Fatura nasıl kesilir?", content_type: "article" }],
    assistantContext: { chat_ready: false, suggested_prompts: ["Nasıl keserim?"] },
    onboarding: { progress_percent: 50, show_wizard: true },
  };
  return {
    useHelp: () => state,
    useHelpOptional: () => state,
    __helpState: state,
  };
});

const { HelpButton } = require("./HelpButton");
const { __helpState } = require("../../context/HelpContext");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("? button opens page intro popover with tour and how-to", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  __helpState.popoverOpen = false;
  await act(async () => {
    root.render(<HelpButton />);
  });
  const btn = host.querySelector('[data-testid="help-page-btn"]');
  expect(btn).not.toBeNull();
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(__helpState.popoverOpen).toBe(true);
  await act(async () => {
    root.render(<HelpButton />);
  });
  expect(host.querySelector('[data-testid="help-popover"]')).not.toBeNull();
  expect(host.textContent).toContain("Faturalar");
  expect(host.textContent).toContain("Sayfa turu");
  expect(host.textContent).toContain("Nasıl yapılır?");
  expect(host.textContent).toContain("Kurulum sihirbazı");
  expect(host.textContent).toContain("Yapay zeka asistanı");
  await act(async () => { root.unmount(); });
  host.remove();
});
