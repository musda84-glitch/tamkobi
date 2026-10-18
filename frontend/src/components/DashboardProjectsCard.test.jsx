import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { DashboardProjectsCard } from "./DashboardProjectsCard";
import { fmtDate } from "../utils/money";

function isoShift(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function render(data) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MemoryRouter><DashboardProjectsCard data={data} /></MemoryRouter>);
  });
  return {
    host,
    cleanup() {
      act(() => { root.unmount(); });
      host.remove();
    },
  };
}

test("progress width, budget percent, overdue color and extra projects", () => {
  const due = isoShift(-6);
  const view = render({
    active: 5,
    overdue: 2,
    cost_total: 80000,
    budget_total: 200000,
    top_projects: [
      { name: "Villa", progress_pct: 62, overdue: false, stage_label: "Kaba", cost_total: 30000, budget_total: 50000 },
      { name: "Ofis", progress_pct: 40, overdue: true, stage_label: "İnce", cost_total: 120000, budget_total: 100000, due_date: due },
      { name: "Depo", progress_pct: 10, overdue: false, stage_label: "Plan", cost_total: 0, budget_total: 0 },
    ],
  });
  const bars = view.host.querySelectorAll("[data-testid='project-progress']");
  expect(bars[0].style.width).toBe("62%");
  expect(bars[1].style.width).toBe("40%");
  expect(bars[0].className).toMatch(/blue/);
  expect(bars[1].className).toMatch(/rose/);
  expect(view.host.textContent).toContain("%40");
  expect(view.host.textContent).toContain("%120");
  expect(view.host.querySelector(".text-rose-600")).toBeTruthy();
  expect(view.host.textContent).toContain(`Teslim ${fmtDate(due)}`);
  expect(view.host.textContent).toContain("6 gün gecikti");
  expect(view.host.textContent).toContain("+2 aktif proje");
  const overdueBox = [...view.host.querySelectorAll("div")].find((el) => el.className.includes("rounded-xl") && el.textContent.includes("Süresi geçen"));
  expect(overdueBox.className).toMatch(/rose/);
  view.cleanup();
});

test("zero budget shows a dash and zero active projects collapse", () => {
  const emptyBudget = render({
    active: 1,
    overdue: 0,
    cost_total: 10,
    budget_total: 0,
    top_projects: [{ name: "A", progress_pct: 5, stage_label: "Plan", cost_total: 0, budget_total: 0 }],
  });
  const box = [...emptyBudget.host.querySelectorAll("div")].find((el) => el.className.includes("rounded-xl") && el.textContent.includes("Bütçe kullanımı"));
  expect(box.textContent).toContain("—");
  expect(box.textContent).not.toMatch(/%\d/);
  emptyBudget.cleanup();

  const none = render({ active: 0, overdue: 0, cost_total: 0, budget_total: 0, top_projects: [] });
  expect(none.host.textContent).toContain("📐 Projeler · Aktif proje yok · Projeler ›");
  expect(none.host.querySelector("a").getAttribute("href")).toBe("/projects");
  none.cleanup();
});
