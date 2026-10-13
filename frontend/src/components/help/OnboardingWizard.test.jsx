/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

jest.mock("axios", () => ({
  get: () => Promise.resolve({ data: {} }),
  post: () => Promise.resolve({ data: {} }),
  put: () => Promise.resolve({ data: {} }),
}));

jest.mock("../../context/AuthContext", () => ({
  API_URL: "http://x/api",
  useAuth: () => ({ user: { email: "a@b.c" }, activeCompany: { id: "c1", name: "Acme" }, reloadSession: jest.fn() }),
}));

jest.mock("../../context/HelpContext", () => ({
  useHelp: () => ({
    onboarding: {
      progress_percent: 33,
      show_wizard: true,
      remaining: ["einvoice", "contact", "product", "invoice"],
      steps: [
        { key: "company", done: true },
        { key: "logo", done: true },
        { key: "einvoice", done: false },
        { key: "contact", done: false },
        { key: "product", done: false },
        { key: "invoice", done: false },
      ],
    },
    showWizard: true,
    patchOnboarding: jest.fn(),
    loadOnboarding: jest.fn(),
    closeWizard: jest.fn(),
    companyId: "c1",
  }),
}));

const { OnboardingWizard } = require("./OnboardingWizard");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("wizard shows progress bar and skip actions", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<OnboardingWizard />);
  });
  expect(host.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="onboarding-progress-bar"]')).not.toBeNull();
  expect(host.textContent).toContain("%33 tamamlandı");
  expect(host.querySelector('[data-testid="onboarding-skip-step"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="onboarding-skip-all"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="onboarding-step-tab-company"]')).not.toBeNull();
  await act(async () => { root.unmount(); });
  host.remove();
});
