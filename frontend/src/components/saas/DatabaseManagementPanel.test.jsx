import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { SYSTEM_SECTIONS } from "./systemSections";
import { SYSTEM_NAV_GROUPS } from "../../navGroups";
import {
  DatabaseManagementPanel,
  DatabaseManagementView,
  POLL_MS,
  formatBytes,
  formatLogin,
} from "./DatabaseManagementPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));

const base = {
  router_enabled: true,
  measured_at: "2026-10-23T07:40:00.000Z",
  maintenance: { label: "Bu gece 02:00–03:30 (en düşük kullanım)", start: "2026-10-24T02:00:00+03:00", end: "2026-10-24T03:30:00+03:00" },
  thresholds: { records: 100000, data_mb: 50, users: 5, growth_pct: 20 },
  totals: {
    companies: 2, real: 1, test: 1,
    modes: { legacy: 1, shared_v2: 1, dedicated: 0 },
    records: 120, bytes: 60 * 1024 * 1024, files: 4, file_bytes: 2048, running: 1,
    running_label: "Matek · %40 · yazma kilitli",
  },
  companies: [
    {
      id: "comp_legacy", name: "Örnek Firma A", test: true, mode: "legacy", moving: false, scheduled: false,
      records: 20, bytes: 4000, files: 0, file_bytes: 0, users: 1, last_login_at: "2026-09-02T08:00:00.000Z",
      growth_pct: 6, recommended: "shared_v2", suitable: true, reason: "Legacy kaldırılıyor; eşik altında",
      has_dedicated_dsn: false, measured_at: "2026-10-23T07:40:00.000Z", largest: null, last_dry_run: null, estimate: null,
      actions: { dry_run: true, apply: true, rollback: false, prepare: false, to_mode: "shared_v2", rollback_move_id: "" },
    },
    {
      id: "comp_matek", name: "Matek", test: false, mode: "shared_v2", moving: true, scheduled: false, mode_to: "dedicated",
      records: 100, bytes: 60 * 1024 * 1024, files: 4, file_bytes: 2048, users: 7, last_login_at: "2026-10-23T07:47:00.000Z",
      growth_pct: 24, recommended: "dedicated", suitable: false, reason: "Veri 60 > 50 MB · Kullanıcı 7 > 5",
      has_dedicated_dsn: true, measured_at: "2026-10-23T07:40:00.000Z",
      largest: { name: "incoming_edoc_xml", bytes: 40 * 1024 * 1024 },
      last_dry_run: {
        ok: true, at: "2026-10-23T07:31:00.000Z", to_mode: "dedicated", collections: 3, records: 100,
        bytes: 60 * 1024 * 1024, files: 4, file_bytes: 2048, warning: "Büyük XML koleksiyonu kopyalaması uzun sürebilir",
      },
      estimate: { label: "≈ 60-75 dk", low: 60, high: 75 },
      actions: { dry_run: false, apply: false, rollback: false, prepare: false, to_mode: "dedicated", rollback_move_id: "" },
    },
  ],
  moves: [
    {
      move_id: "mv_live", job_id: "job_live", company_id: "comp_matek", company_name: "Matek", test: false,
      from_mode: "shared_v2", to_mode: "dedicated", status: "running",
      started_at: "2026-10-23T07:58:00.000Z", finished_at: "",
      progress_pct: 40, progress_label: "%40 · 1/3 koleksiyon", lock_label: "12 dk",
      checksum_label: "bekleniyor", checksum_ok: null, scheduled: false,
    },
  ],
};

async function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  return {
    host,
    root,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  jest.useRealTimers();
});

test("menüde veritabanı yönetimi bölümü var", () => {
  const section = SYSTEM_SECTIONS.find((item) => item.key === "veritabani-yonetimi");
  expect(section.label).toBe("Veritabanı Yönetimi");
  expect(section.path).toBe("/sistem/veritabani-yonetimi");
  const rules = SYSTEM_NAV_GROUPS.find((group) => group.id === "kurallar");
  expect(rules.paths).toContain("/sistem/veritabani-yonetimi");
});

test("sayfa tablo ve eşik panelini gösterir", async () => {
  const view = await mount(<DatabaseManagementView data={base} onDryRun={jest.fn()} onApply={jest.fn()} onRollback={jest.fn()} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={jest.fn()} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  expect(view.host.querySelector("[data-testid='dbm-page']").textContent).toMatch(/Veritabanı Yönetimi/);
  expect(view.host.querySelector("[data-testid='dbm-table']").textContent).toMatch(/Matek/);
  expect(view.host.querySelector("[data-testid='dbm-table']").textContent).toMatch(/Örnek Firma A/);
  expect(view.host.querySelector("[data-testid='dbm-row-comp_legacy']").textContent).toMatch(/test hesabı/);
  expect(view.host.querySelector("[data-testid='dbm-threshold-records']").value).toBe("100000");
  expect(view.host.querySelector("[data-testid='dbm-threshold-data_mb']").value).toBe("50");
  expect(view.host.querySelector("[data-testid='dbm-card-running']").textContent).toMatch(/%40/);
  expect(formatBytes(60 * 1024 * 1024)).toMatch(/MB/);
  expect(formatLogin("")).toBe("—");
  view.unmount();
});

test("taşı onay penceresi deneme ve onay kutusu ister", async () => {
  const onApply = jest.fn();
  const onDryRun = jest.fn();
  const view = await mount(<DatabaseManagementView data={base} onDryRun={onDryRun} onApply={onApply} onRollback={jest.fn()} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={jest.fn()} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-apply-comp_legacy']").click();
  });
  const dialog = view.host.querySelector("[data-testid='dbm-confirm']");
  expect(dialog.textContent).toMatch(/Taşımayı Onayla — Örnek Firma A/);
  expect(dialog.querySelector("[data-testid='dbm-dry-required']")).toBeTruthy();
  expect(dialog.querySelector("[data-testid='dbm-move-now']").disabled).toBe(true);
  expect(dialog.querySelector("[data-testid='dbm-schedule']").disabled).toBe(true);
  await act(async () => {
    dialog.querySelector("[data-testid='dbm-confirm-dry']").click();
  });
  expect(onDryRun).toHaveBeenCalledWith(expect.objectContaining({ id: "comp_legacy" }));
  expect(onApply).not.toHaveBeenCalled();
  view.unmount();
});

test("deneme varken şimdi taşı ve bakım planı onayı bekler", async () => {
  const ready = {
    ...base,
    companies: base.companies.map((row) => row.id === "comp_legacy" ? {
      ...row,
      last_dry_run: { ok: true, at: "2026-10-23T07:31:00.000Z", to_mode: "shared_v2", collections: 2, records: 20, bytes: 4000, files: 0, file_bytes: 0, warning: "" },
      estimate: { label: "≈ 2-3 dk", low: 2, high: 3 },
    } : row),
  };
  const onApply = jest.fn();
  const view = await mount(<DatabaseManagementView data={ready} onDryRun={jest.fn()} onApply={onApply} onRollback={jest.fn()} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={jest.fn()} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-apply-comp_legacy']").click();
  });
  const move = view.host.querySelector("[data-testid='dbm-move-now']");
  expect(move.disabled).toBe(true);
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-confirm-check']").click();
  });
  expect(view.host.querySelector("[data-testid='dbm-move-now']").disabled).toBe(false);
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-schedule']").click();
  });
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "comp_legacy" }), "maintenance");
  view.unmount();
});

test("yönlendirici kapalıyken taşı ve geri al pasif", async () => {
  const off = {
    ...base,
    router_enabled: false,
    companies: base.companies.map((row) => row.id === "comp_legacy" ? row : { ...row, moving: false, actions: { dry_run: false, apply: false, rollback: true, prepare: false, to_mode: "shared_v2", rollback_move_id: "mv1" } }),
  };
  const onRollback = jest.fn();
  const view = await mount(<DatabaseManagementView data={off} onDryRun={jest.fn()} onApply={jest.fn()} onRollback={onRollback} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={jest.fn()} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  expect(view.host.querySelector("[data-testid='dbm-router-off']").textContent).toMatch(/kapalı/);
  expect(view.host.querySelector("[data-testid='dbm-apply-comp_legacy']").disabled).toBe(true);
  expect(view.host.querySelector("[data-testid='dbm-rollback-comp_matek']").disabled).toBe(true);
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-rollback-comp_matek']").click();
  });
  expect(onRollback).not.toHaveBeenCalled();
  view.unmount();
});

test("eşik kaydı ve canlı ilerleme", async () => {
  const onSave = jest.fn();
  const first = base;
  const next = {
    ...base,
    moves: [{ ...base.moves[0], progress_pct: 80, progress_label: "%80 · 3/3 koleksiyon" }],
    totals: { ...base.totals, running_label: "Matek · %80 · yazma kilitli" },
  };
  const view = await mount(<DatabaseManagementView data={first} onDryRun={jest.fn()} onApply={jest.fn()} onRollback={jest.fn()} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={onSave} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  expect(view.host.querySelector("[data-testid='dbm-progress-mv_live']").textContent).toMatch(/%40/);
  const input = view.host.querySelector("[data-testid='dbm-threshold-users']");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, "8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    view.host.querySelector("[data-testid='dbm-threshold-save']").click();
  });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ users: 8, records: 100000 }));
  await view.rerender(<DatabaseManagementView data={next} onDryRun={jest.fn()} onApply={jest.fn()} onRollback={jest.fn()} onRecover={jest.fn()} onCancel={jest.fn()} onSaveThresholds={onSave} onResetThresholds={jest.fn()} onPrepare={jest.fn()} />);
  expect(view.host.querySelector("[data-testid='dbm-progress-mv_live']").textContent).toMatch(/%80 · 3\/3 koleksiyon/);
  view.unmount();
});

test("panel ölçümü çeker ve ilerlemeyi yeniler", async () => {
  let pct = 40;
  axios.get.mockImplementation(() => Promise.resolve({
    data: {
      ...base,
      moves: [{ ...base.moves[0], progress_pct: pct, progress_label: `%${pct} · koleksiyon` }],
    },
  }));
  axios.mockResolvedValue({ data: {} });
  jest.useFakeTimers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DatabaseManagementPanel />);
  });
  await act(async () => {});
  expect(host.querySelector("[data-testid='dbm-page']")).toBeTruthy();
  expect(host.textContent).toMatch(/%40/);
  pct = 80;
  await act(async () => {
    jest.advanceTimersByTime(POLL_MS);
  });
  await act(async () => {});
  expect(host.textContent).toMatch(/%80/);
  expect(axios.get).toHaveBeenCalledWith("http://test/api/system/storage-admin", expect.any(Object));
  act(() => root.unmount());
  host.remove();
});
