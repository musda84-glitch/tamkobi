import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SupportContactBar } from "./SupportContactBar";

const mockAuth = jest.fn();

jest.mock("../context/AuthContext", () => ({
  useAuth: () => mockAuth(),
}));

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}), { virtual: true });

jest.mock("./HeaderFxRates", () => ({ HeaderFxRates: () => <div data-testid="fx">fx</div> }));
jest.mock("./HeaderQuickActions", () => ({ GlobalSearch: () => <div data-testid="search">search</div> }));
jest.mock("../utils/selfPersonnelNav", () => ({
  personelCanUseErpShortcuts: () => true,
}));
jest.mock("../utils/supportAccess", () => ({
  supportTicketsAllowed: () => true,
  supportContactAllowed: () => false,
}));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

test("hides when support_bar feature is off", async () => {
  mockAuth.mockReturnValue({
    license: {},
    addonOn: () => true,
    user: { role: "production", features: { support_bar: false } },
    can: () => true,
    moduleOn: () => true,
    feature: (k) => k !== "support_bar",
  });
  await act(async () => {
    createRoot(host).render(<SupportContactBar companyId="c1" />);
  });
  expect(host.querySelector("[data-testid='support-contact-bar']")).toBeNull();
});

test("shows when support_bar feature is on", async () => {
  mockAuth.mockReturnValue({
    license: { support: { email: "a@b.com" } },
    addonOn: () => true,
    user: { role: "manager", features: { support_bar: true } },
    can: () => true,
    moduleOn: () => true,
    feature: () => true,
  });
  await act(async () => {
    createRoot(host).render(<SupportContactBar companyId="c1" />);
  });
  expect(host.querySelector("[data-testid='support-contact-bar']")).not.toBeNull();
});
