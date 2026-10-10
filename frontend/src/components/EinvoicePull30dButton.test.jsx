import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { EinvoicePull30dButton } from "./EinvoicePull30dButton";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}), { virtual: true });

test("pull button posts incoming/sync with days=30", async () => {
  axios.post.mockResolvedValue({ data: { message: "2 yeni geldi.", pulled: 2 } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<EinvoicePull30dButton companyId="comp1" />);
  });
  const btn = host.querySelector('[data-testid="einvoice-pull-30d"]');
  expect(btn?.textContent).toMatch(/Son 30 günü çek/);
  await act(async () => { btn.click(); });
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringMatching(/\/einvoice\/incoming\/sync$/),
    null,
    expect.objectContaining({
      params: { company_id: "comp1", days: 30, auto_process: false },
    }),
  );
  root.unmount();
  host.remove();
});
