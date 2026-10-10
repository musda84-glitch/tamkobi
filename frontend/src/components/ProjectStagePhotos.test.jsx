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

test("stage photo show/hide controls sit outside the thumb (no overlay on image)", () => {
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
  expect(host.querySelectorAll('[data-testid="project-stage-vis-PRJ-2026-0027"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="project-stage-show-PRJ-2026-0027"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="project-stage-hide-PRJ-2026-0027"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="project-stage-remove-PRJ-2026-0027"]')).toHaveLength(2);

  // Thumb üzerinde absolute inset overlay yok; kontroller ayrı satırda
  const vis = host.querySelector('[data-testid="project-stage-vis-PRJ-2026-0027"]');
  expect(vis?.className).not.toMatch(/absolute|inset-0/);
  expect(host.textContent).toMatch(/üzerine gelince önizleme/i);
  expect(host.textContent).not.toMatch(/basılı tutun/i);
});
