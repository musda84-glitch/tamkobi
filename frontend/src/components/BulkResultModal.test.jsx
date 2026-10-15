import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { BulkResultModal } from "./BulkResultModal";

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

test("approve/cancel result modal lists error reasons", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BulkResultModal
        title="Toplu iptal sonucu"
        items={[
          { id: "1", label: "EA-1", outcome: "ok" },
          { id: "2", label: "EA-2", outcome: "skipped", reason: "Taslak değil" },
          { id: "3", label: "EA-3", outcome: "error", reason: "Fatura zaten iptal edildi / iptal ediliyor" },
        ]}
        onClose={() => {}}
      />,
    );
  });
  expect(host.querySelector('[data-testid="bulk-result-modal"]')).not.toBeNull();
  const text = host.textContent;
  expect(text).toContain("EA-3");
  expect(text).toContain("Fatura zaten iptal edildi / iptal ediliyor");
  expect(text).toContain("Taslak değil");
  expect(text).toContain("EA-1");
});
