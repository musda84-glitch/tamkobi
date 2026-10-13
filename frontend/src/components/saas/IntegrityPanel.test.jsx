import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { IntegrityPanel } from "./IntegrityPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));

describe("IntegrityPanel", () => {
  let host;
  let root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    axios.get.mockReset();
    axios.post.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("scans and shows summary; dry-run preview", async () => {
    axios.get.mockResolvedValue({
      data: {
        summary: { orphan_moves: 2, paid_missing_moves: 1, drift_accounts: 0, heuristic_links: 1 },
        orphan_bonus_moves: [{ tx_id: "t1", kind: "bank", amount: 10, description: "x" }],
        orphan_payroll_moves: [],
        orphan_loan_moves: [],
        paid_bonus_without_moves: [],
        paid_payroll_without_moves: [],
        cash_balance_drift: [],
      },
    });
    axios.post.mockResolvedValue({
      data: { dry_run: true, actions: [{ target: { source_id: "x" }, result: { status: "would_reverse" } }], drift_fixes: [] },
    });

    await act(async () => {
      root.render(<IntegrityPanel companyId="c1" />);
    });
    expect(host.querySelector('[data-testid="integrity-panel"]')).not.toBeNull();

    await act(async () => {
      host.querySelector('[data-testid="integrity-scan-btn"]').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/admin/integrity/orphans"),
      expect.objectContaining({ params: { company_id: "c1" } }),
    );
    expect(host.querySelector('[data-testid="integrity-summary"]')?.textContent).toContain("2");

    await act(async () => {
      host.querySelector('[data-testid="integrity-preview-btn"]').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/integrity/cleanup"),
      expect.objectContaining({ company_id: "c1", dry_run: true }),
      expect.anything(),
    );
    expect(host.querySelector('[data-testid="integrity-preview"]')).not.toBeNull();
  });
});
