import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MobileFilterSheet } from "./MobileFilterSheet";

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  document.body.style.overflow = "";
});

const button = () => document.querySelector('[data-testid="mobile-filter-button"]');
const sheet = () => document.querySelector('[data-testid="mobile-filter-sheet"]');

async function renderSheet(props) {
  await act(async () => {
    root.render(<MobileFilterSheet {...props} />);
  });
}

test("buton sheet'i açar; çarpı, karartma ve Uygula kapatır", async () => {
  await renderSheet({ activeCount: 0, children: <input aria-label="alan" defaultValue="x" /> });
  expect(sheet()).toBeNull();

  await act(async () => { button().click(); });
  const open = sheet();
  expect(open).not.toBeNull();
  expect(open.className).toContain("fixed");
  expect(open.className).toContain("bottom-0");
  expect(open.className).toContain("inset-x-0");
  expect(open.className).toContain("rounded-t-2xl");
  expect(open.className).toContain("max-h-[78vh]");
  expect(open.querySelector(".overflow-y-auto")).not.toBeNull();
  expect(document.querySelector('[data-testid="mobile-filter-handle"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="mobile-filter-title"]').textContent).toBe("Filtreler (0)");
  expect(document.querySelector('[data-testid="mobile-filter-backdrop"]').className).toContain("bg-black/40");

  await act(async () => { document.querySelector('[data-testid="mobile-filter-close"]').click(); });
  expect(sheet()).toBeNull();

  await act(async () => { button().click(); });
  await act(async () => { document.querySelector('[data-testid="mobile-filter-backdrop"]').click(); });
  expect(sheet()).toBeNull();

  await act(async () => { button().click(); });
  await act(async () => { document.querySelector('[data-testid="mobile-filter-apply"]').click(); });
  expect(sheet()).toBeNull();

  await act(async () => { button().click(); });
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(sheet()).toBeNull();
});

test("rozet activeCount 0 iken yok, 2 iken Filtreler (2)", async () => {
  await renderSheet({ activeCount: 0, children: null });
  expect(button().textContent).toBe("Filtreler");
  expect(document.querySelector('[data-testid="mobile-filter-badge"]')).toBeNull();
  expect(button().className).toContain("bg-white");
  expect(button().className).toContain("border-slate-200");
  expect(button().className).toContain("text-slate-700");
  expect(button().className).toContain("h-11");

  await renderSheet({ activeCount: 2, children: null });
  const badge = document.querySelector('[data-testid="mobile-filter-badge"]');
  expect(badge).not.toBeNull();
  expect(button().textContent).toBe("Filtreler (2)");
  expect(badge.className).toContain("bg-emerald-600");
  expect(badge.className).toContain("text-white");
  expect(button().className).toContain("bg-emerald-50");
  expect(button().className).toContain("border-emerald-300");
  expect(button().className).toContain("text-emerald-700");
});

test("Temizle onClear çağırır ve alanlar varsayılana döner", async () => {
  const onClear = jest.fn();
  function Harness() {
    const [status, setStatus] = useState("pending");
    return (
      <MobileFilterSheet
        activeCount={status === "all" ? 0 : 1}
        onClear={() => { onClear(); setStatus("all"); }}
      >
        <select aria-label="durum" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="demo-status">
          <option value="all">Tümü</option>
          <option value="pending">Bekleyen</option>
        </select>
      </MobileFilterSheet>
    );
  }
  await act(async () => { root.render(<Harness />); });
  await act(async () => { button().click(); });
  const select = document.querySelector('[data-testid="demo-status"]');
  expect(select.value).toBe("pending");
  await act(async () => { document.querySelector('[data-testid="mobile-filter-clear"]').click(); });
  expect(onClear).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid="demo-status"]').value).toBe("all");
  expect(sheet()).not.toBeNull();
});
