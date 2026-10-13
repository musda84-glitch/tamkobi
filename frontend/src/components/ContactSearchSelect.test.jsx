import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ContactSearchSelect, CONTACT_SEARCH_DEBOUNCE_MS } from "./ContactSearchSelect";

jest.mock("axios", () => {
  const impl = { get: jest.fn(), post: jest.fn(), defaults: {}, isCancel: () => false };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 20, has_more: false } });
});

afterEach(() => {
  host.remove();
  jest.useRealTimers();
});

function render() {
  return act(async () => {
    createRoot(host).render(
      <ContactSearchSelect companyId="c1" value="" onChange={() => {}} testId="cs" />,
    );
  });
}

test("debounce is 300 ms and query is sent after the wait", async () => {
  jest.useFakeTimers();
  await render();
  await act(async () => {
    host.querySelector('[data-testid="cs-trigger"]').click();
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][1].params.q).toBe("");

  const input = document.querySelector('[data-testid="cs-search"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "ersay");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    jest.advanceTimersByTime(CONTACT_SEARCH_DEBOUNCE_MS - 1);
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.get.mock.calls[1][1].params).toMatchObject({ company_id: "c1", q: "ersay", page: 1, limit: 20 });
});
