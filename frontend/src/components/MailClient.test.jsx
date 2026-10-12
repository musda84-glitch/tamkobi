import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import { MailClient } from "./MailClient";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

test("needs_reauth shows Şifreyi yeniden girin warning", async () => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/comm/mail/account")) {
      return Promise.resolve({
        data: {
          email: "a@firma.com",
          display_name: "Firma",
          status: "needs_reauth",
          last_error: "Kayıtlı şifre çözülemedi — lütfen yeniden girin.",
          has_password: true,
        },
      });
    }
    if (String(url).includes("/comm/mail/logs")) {
      return Promise.resolve({ data: [] });
    }
    if (String(url).includes("/comm/mail/folders")) {
      return Promise.resolve({ data: [{ name: "INBOX" }] });
    }
    if (String(url).includes("/comm/mail/messages")) {
      return Promise.resolve({ data: { messages: [], total: 0 } });
    }
    return Promise.resolve({ data: {} });
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MailClient companyId="c1" />);
  });
  await act(async () => {});
  const banner = host.querySelector('[data-testid="mail-reauth-banner"]');
  expect(banner).toBeTruthy();
  expect(banner.textContent).toMatch(/Şifreyi yeniden girin/);
  root.unmount();
  host.remove();
});
