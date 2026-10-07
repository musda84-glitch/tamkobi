import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { PaymentTargetSelect } from "./PaymentTargetSelect";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => ({}) }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/banking/partners")) return Promise.resolve({ data: [] });
    if (String(url).includes("/banking/accounts")) {
      return Promise.resolve({
        data: [
          {
            id: "cc-co",
            type: "credit_card",
            card_owner: "company",
            bank_name: "Garanti",
            account_name: "Şirket Kartı",
            current_balance: -100,
          },
          {
            id: "cc-cu",
            type: "credit_card",
            card_owner: "customer",
            linked_contact_name: "Ayşe Yılmaz",
            bank_name: "Yapı Kredi",
            account_name: "Müşteri Kartı",
            current_balance: -50,
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
});
afterEach(() => {
  host.remove();
});

test("spend select groups customer credit cards separately", async () => {
  await act(async () => {
    createRoot(host).render(
      <PaymentTargetSelect companyId="c1" value="" onChange={() => {}} collectableOnly={false} includePartners={false} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const html = host.innerHTML;
  expect(html).toContain("Müşteri Kredi Kartı");
  expect(html).toContain("Ayşe Yılmaz");
  expect(html).toContain("value=\"cc-cu\"");
});
