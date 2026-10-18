import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("./ProjectStagePhotos", () => ({
  ProjectStagePhotos: ({ project, stages, onUpdated }) => (
    <div
      data-testid="mock-stage-photos"
      data-project-id={project?.id}
      data-stage-keys={(stages || []).map((stage) => stage.key).join(",")}
      data-has-update={typeof onUpdated === "function" ? "1" : "0"}
    />
  ),
}));

import { ProjectDetailPanel } from "./ProjectDetailPanel";

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

const stages = [
  { key: "planning", label: "Planlama" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

function renderPanel(extra = {}) {
  const props = {
    project: {
      id: "p1",
      project_number: "PRJ-1",
      name: "Cephe",
      contact_name: "Ada",
      status: "planning",
      production_steps: [{ no: 1, name: "Kesim" }],
    },
    tab: "photos",
    onTabChange: jest.fn(),
    onClose: jest.fn(),
    stages,
    onUpdated: jest.fn(),
    ...extra,
  };
  root = createRoot(host);
  act(() => { root.render(<ProjectDetailPanel {...props} />); });
  return props;
}

test("sekmeler değişir ve fotoğraflar sekmesi ProjectStagePhotos çizer", () => {
  const props = renderPanel();
  const photos = host.querySelector('[data-testid="mock-stage-photos"]');
  expect(photos).toBeTruthy();
  expect(photos.getAttribute("data-project-id")).toBe("p1");
  expect(photos.getAttribute("data-stage-keys")).toBe("planning,completed");
  expect(photos.getAttribute("data-has-update")).toBe("1");
  expect(host.querySelector('[data-testid="project-detail-panel"]')).toBeTruthy();

  act(() => { host.querySelector('[data-testid="project-detail-tab-production"]').click(); });
  expect(props.onTabChange).toHaveBeenCalledWith("production");

  act(() => {
    root.render(<ProjectDetailPanel {...props} tab="production" />);
  });
  expect(host.querySelector('[data-testid="mock-stage-photos"]')).toBeNull();
  expect(host.textContent).toContain("Kesim");
  expect(host.querySelector('[data-testid="project-detail-tab-money"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-detail-tab-tasks"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="project-detail-tab-tracking"]')).toBeTruthy();
});

test("ESC paneli kapatır", () => {
  const props = renderPanel();
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(props.onClose).toHaveBeenCalled();
});
