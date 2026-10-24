import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import axios from "axios";
import { SYSTEM_SECTIONS } from "./systemSections";
import { SYSTEM_NAV_GROUPS } from "../../navGroups";
import { OfflineAdminPanel, OfflineAdminView } from "./OfflineAdminPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));

const sample = {
  totals: { companies: 2, enabled: 1, pending: 4, conflicts: 1 },
  companies: [
    {
      id: "comp_a", name: "Ada Ticaret", offline_enabled: true, offline_max_minutes: 10,
      idempotency_ttl_hours: 24, pending: 3, conflicts: 1,
      offline_modules: { pos: true, pick: true, order: false },
    },
    {
      id: "comp_b", name: "Beta", offline_enabled: false, offline_max_minutes: 15,
      idempotency_ttl_hours: 48, pending: 1, conflicts: 0,
      offline_modules: { pos: false, pick: true, order: true },
    },
  ],
};

async function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(ui); });
  return { host, unmount() { act(() => root.unmount()); host.remove(); } };
}

afterEach(() => { document.body.innerHTML = ""; });

test("çevrimdışı bölümü kurallar menüsündedir", () => {
  const section = SYSTEM_SECTIONS.find((item) => item.key === "cevrimdisi");
  expect(section.label).toBe("Çevrimdışı");
  expect(section.path).toBe("/sistem/cevrimdisi");
  const rules = SYSTEM_NAV_GROUPS.find((group) => group.id === "kurallar");
  expect(rules.paths).toContain("/sistem/cevrimdisi");
});

test("firma satırı bekleyen ve çakışan sayıları gösterir, kayıt gövdesi ayarı taşır", async () => {
  const onSave = jest.fn();
  const view = await mount(<OfflineAdminView data={sample} onSave={onSave} />);
  expect(view.host.querySelector("[data-testid='offline-admin-page']").textContent).toMatch(/Çevrimdışı/);
  expect(view.host.querySelector("[data-testid='offline-card-pending']").textContent).toMatch(/4/);
  expect(view.host.querySelector("[data-testid='offline-conflicts-comp_a']").textContent).toBe("1");
  expect(view.host.querySelector("[data-testid='offline-pending-comp_a']").textContent).toBe("3");
  expect(view.host.querySelector("[data-testid='offline-module-order-comp_a']").checked).toBe(false);
  await act(async () => {
    view.host.querySelector("[data-testid='offline-save-comp_a']").click();
  });
  expect(onSave).toHaveBeenCalledWith("comp_a", {
    offline_enabled: true,
    offline_max_minutes: 10,
    idempotency_ttl_hours: 24,
    offline_modules: { pos: true, pick: true, order: false },
  });
  view.unmount();
});

test("panel süper admin ucundan listeyi yükler", async () => {
  axios.get.mockResolvedValue({ data: sample });
  const view = await mount(<OfflineAdminPanel />);
  expect(view.host.querySelector("[data-testid='offline-row-comp_a']")).not.toBeNull();
  expect(axios.get).toHaveBeenCalledWith("http://test/api/system/offline-admin", { withCredentials: true });
  view.unmount();
});
