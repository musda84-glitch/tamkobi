import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProjectRowCard } from "./ProjectRowCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled, ...rest }) => (
    <button type="button" disabled={disabled} onClick={() => !disabled && onSelect?.()} {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuSubContent: ({ children, ...rest }) => <div {...rest}>{children}</div>,
}));

const stages = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "on_hold", label: "Beklemede" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

const statusMap = {
  planning: ["Planlama", "bg-slate-100 text-slate-600"],
  active: ["Devam Ediyor", "bg-blue-50 text-blue-700"],
  on_hold: ["Beklemede", "bg-amber-50 text-amber-700"],
  completed: ["Tamamlandı", "bg-emerald-50 text-emerald-700"],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  jest.restoreAllMocks();
});

function renderCard(project, extra = {}) {
  root = createRoot(host);
  const props = {
    stages,
    finalStage: "completed",
    statusMap,
    statusFallback: {},
    quotes: [],
    onSetStatus: jest.fn(),
    onAddQuote: jest.fn(),
    onEdit: jest.fn(),
    onPrintQuote: jest.fn(),
    onExpense: jest.fn(),
    onTeam: jest.fn(),
    onTrack: jest.fn(),
    onDelete: jest.fn(),
    onOpenDetail: jest.fn(),
    ...extra,
    project,
  };
  act(() => { root.render(<ProjectRowCard {...props} />); });
  return props;
}

test("başlık, durum chip'i ve aşama adımları render edilir", () => {
  renderCard({
    id: "p1",
    project_number: "PRJ-1",
    quote_number: "TKL-9",
    name: "Cephe İşi",
    contact_name: "Ada Yapı",
    status: "active",
  });
  expect(host.textContent).toContain("PRJ-1");
  expect(host.textContent).toContain("TKL-9");
  expect(host.textContent).toContain("Cephe İşi");
  expect(host.textContent).toContain("Ada Yapı");
  expect(host.textContent).toContain("Devam Ediyor");
  stages.forEach((stage) => {
    expect(host.querySelector(`[data-testid="project-stage-step-PRJ-1-${stage.key}"]`)).toBeTruthy();
  });
  expect(host.querySelector('[data-testid="project-stage-step-PRJ-1-active"]').getAttribute("aria-current")).toBe("step");
  expect(host.querySelector('[data-testid="project-status-PRJ-1"]')).toBeTruthy();
});

test("ara aşama setStatus çağırır; son aşamada confirm iptali çağırmaz", () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  const props = renderCard({ id: "p1", project_number: "PRJ-1", name: "Cephe İşi", status: "planning" });
  act(() => {
    host.querySelector('[data-testid="project-stage-step-PRJ-1-active"]').click();
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(props.onSetStatus).toHaveBeenCalledWith("projects", "p1", "active");

  act(() => {
    host.querySelector('[data-testid="project-stage-step-PRJ-1-completed"]').click();
  });
  expect(confirm).toHaveBeenCalledWith("Cephe İşi projesi tamamlandı olarak işaretlensin mi?");
  expect(props.onSetStatus).toHaveBeenCalledTimes(1);
});

test("bilinmeyen durum Diğer chip'i gösterir", () => {
  renderCard({ id: "p1", project_number: "PRJ-1", name: "Cephe", status: "archived", contact_name: "Ada" });
  expect(host.textContent).toContain("Diğer: archived");
  expect(host.querySelector("[aria-current='step']")).toBeNull();
});

test("tutar satırı boşsa linkler, masraf kırmızı ve harcanan görünür", () => {
  const props = renderCard({
    id: "p1",
    project_number: "PRJ-1",
    name: "Boş",
    status: "planning",
    budget: 0,
    quoted_total: 0,
    invoiced_total: 0,
    expense_total: 0,
  });
  expect(host.textContent).toContain("Henüz tutar yok");
  const add = [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Teklif ekle");
  act(() => { add.click(); });
  expect(props.onAddQuote).toHaveBeenCalledWith(expect.objectContaining({ project_number: "PRJ-1" }));

  act(() => {
    root.render(
      <ProjectRowCard
        {...props}
        project={{ id: "p1", project_number: "PRJ-1", name: "Masraf", status: "active", expense_total: 120, budget: 10 }}
      />,
    );
  });
  const expense = host.querySelector('[data-testid="project-expense-total-PRJ-1"]');
  expect(expense.className).toContain("text-rose-700");
  expect(host.textContent).not.toContain("Henüz tutar yok");

  act(() => {
    root.render(
      <ProjectRowCard
        {...props}
        project={{
          id: "p1",
          project_number: "PRJ-1",
          name: "Harcama",
          status: "active",
          budget: 5,
          purchase_invoice_total: 40,
          cost_total: 90,
          expense_total: 0,
        }}
      />,
    );
  });
  expect(host.textContent).toContain("Harcanan");
  expect(host.querySelector('[data-testid="project-stats-PRJ-1"]')).toBeTruthy();
});

test("üretim özeti adım sayısını açar, tamamlanan sayısı yazmaz", () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({ no: index + 1, name: `Adım ${index + 1}` }));
  renderCard({
    id: "p1",
    project_number: "PRJ-1",
    name: "Üretim",
    status: "active",
    production_order_code: "UE-4",
    show_production_steps: true,
    production_steps: steps,
  });
  expect(host.textContent).toContain("8 adım");
  expect(host.textContent).toContain("1. Adım 1");
  expect(host.textContent).not.toContain("+2 adım daha");
  expect(host.textContent.toLowerCase()).not.toContain("tamamlanan");
  act(() => {
    host.querySelector('[data-testid="project-steps-toggle-PRJ-1"]').click();
  });
  expect(host.textContent).toContain("+2 adım daha");
  expect(host.querySelector('[data-testid="project-recipe-steps-PRJ-1"]')).toBeTruthy();
  expect(host.textContent.toLowerCase()).not.toContain("tamamlanan");
});

test("fotoğraf şeridi küçük resimleri gösterir ve yükleme paneli fotoğraflarda açar", () => {
  const props = renderCard({
    id: "p1",
    project_number: "PRJ-1",
    name: "Foto",
    status: "active",
    stage_photos: [
      { url: "/a.jpg", stage: "planning", stage_label: "Planlama" },
      { url: "/b.jpg", stage: "active", stage_label: "Devam Ediyor" },
    ],
  });
  const strip = host.querySelector('[data-testid="project-photo-strip-PRJ-1"]');
  expect(strip.querySelectorAll("img")).toHaveLength(2);
  expect(strip.textContent).toContain("2 fotoğraf");
  act(() => {
    host.querySelector('[data-testid="project-photo-upload-open-PRJ-1"]').click();
  });
  expect(props.onOpenDetail).toHaveBeenCalledWith("photos");
});
