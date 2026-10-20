import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import axios from "axios";
import { PlatformSmsPanel } from "./PlatformSmsPanel";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));

const RAW_PHONE = "+905551112233";
const RESET_MESSAGE = "Sifre sifirlama https://app.example/sifre-sifirla?t=LEAK-RESET-LINK";

const SETTINGS = {
  provider: "netgsm",
  usercode: "user1",
  msgheader: "TAMKOBI",
  is_active: true,
  verified: true,
  verify_message: "OK",
  has_password: true,
  password_unreadable: false,
  providers: [{ id: "netgsm", name: "Netgsm" }],
};

const LOGS = [
  {
    id: "sms_ann",
    created_at: "2026-05-04T00:00:00+00:00",
    phone: RAW_PHONE,
    phone_masked: "•••8877",
    status: "sent",
    context: "announcement",
    message: "Planli duyuru",
    message_redacted: false,
  },
  {
    id: "sms_reset",
    created_at: "2026-05-03T00:00:00+00:00",
    phone: RAW_PHONE,
    phone_masked: "•••2233",
    status: "sent",
    context: "erp_reset",
    message: RESET_MESSAGE,
    message_redacted: true,
    ref_id: "LEAK-RESET-TOKEN",
  },
];

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockReset();
  axios.get.mockImplementation((url) => {
    const target = String(url);
    if (target.includes("/system/sms/logs")) return Promise.resolve({ data: { items: LOGS, total: LOGS.length } });
    if (target.includes("/system/password-resets/failed")) return Promise.resolve({ data: { items: [] } });
    if (target.includes("/system/sms")) return Promise.resolve({ data: SETTINGS });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

test("log tablosu maskeli telefon gösterir ve gizli bağlamı gizler", async () => {
  await act(async () => {
    root.render(<PlatformSmsPanel />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });

  const logs = host.querySelector("[data-testid='platform-sms-logs']");
  expect(logs).toBeTruthy();
  expect(logs.textContent).toContain("•••8877");
  expect(logs.textContent).toContain("•••2233");
  expect(logs.textContent).toContain("Planli duyuru");
  expect(logs.textContent).not.toContain(RAW_PHONE);
  expect(logs.textContent).not.toContain("905551112233");
  expect(logs.textContent).not.toContain(RESET_MESSAGE);
  expect(logs.textContent).not.toContain("LEAK-RESET-TOKEN");

  const hidden = logs.querySelector("[title='Gizli bağlam']");
  expect(hidden).toBeTruthy();
  expect(hidden.textContent).toBe("—");
});
