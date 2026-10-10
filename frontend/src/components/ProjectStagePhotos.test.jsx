import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProjectStagePhotos } from "./ProjectStagePhotos";

jest.mock("../utils/HoverImageThumb", () => ({
  HoverImageThumb: ({ src, testId }) => <img src={src} alt="" data-testid={testId} />,
}));

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn(), put: jest.fn() },
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("../utils/compressImage", () => ({
  compressImageFile: async (f) => f,
}));

jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
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

test("stage photo visibility is a single toggle under the thumb", () => {
  render(
    <ProjectStagePhotos
      project={{
        id: "p1",
        project_number: "PRJ-2026-0027",
        status: "survey",
        stage_photos: [
          { url: "/api/files/a.webp", stage: "survey", visibility: "show" },
          { url: "/api/files/b.webp", stage: "survey", visibility: "hide" },
        ],
      }}
      stages={[
        { key: "survey", label: "Keşif" },
        { key: "done", label: "Tamamlandı" },
      ]}
    />,
  );

  expect(host.querySelectorAll('[data-testid="project-stage-thumb-PRJ-2026-0027"]')).toHaveLength(2);
  const toggles = host.querySelectorAll('[data-testid="project-stage-vis-toggle-PRJ-2026-0027"]');
  expect(toggles).toHaveLength(2);
  expect(toggles[0].getAttribute("data-visible")).toBe("1");
  expect(toggles[1].getAttribute("data-visible")).toBe("0");
  // Eski çift buton yok
  expect(host.querySelectorAll('[data-testid="project-stage-show-PRJ-2026-0027"]')).toHaveLength(0);
  expect(host.querySelectorAll('[data-testid="project-stage-hide-PRJ-2026-0027"]')).toHaveLength(0);
  expect(host.querySelectorAll('[data-testid="project-stage-remove-PRJ-2026-0027"]')).toHaveLength(2);

  const vis = host.querySelector('[data-testid="project-stage-vis-PRJ-2026-0027"]');
  expect(vis?.className).not.toMatch(/absolute|inset-0/);
  expect(host.textContent).toMatch(/göz düğmesi/i);
});
