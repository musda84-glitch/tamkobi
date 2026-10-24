/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { AiProviderPanel } from "./AiProviderPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});

jest.mock("../../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS = {
  enabled: true,
  provider: "openai",
  advisor_model: "gpt-4o",
  extract_model: "gpt-4.1",
  base_url: "",
  has_key: true,
  has_env_key: false,
  key_hint: "abcd",
  ready: true,
  catalog: [
    { id: "openai", label: "OpenAI", hint: "Doğrudan API anahtarı.", models: [{ id: "gpt-4o", label: "GPT-4o" }, { id: "gpt-4.1", label: "GPT-4.1" }] },
    { id: "anthropic", label: "Anthropic", models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }] },
    { id: "google", label: "Google Gemini", models: [{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }] },
    { id: "emergent", label: "Emergent", models: [{ id: "gpt-5.4", label: "GPT-5.4" }] },
    { id: "custom", label: "Özel uç nokta", custom: true, models: [] },
  ],
};

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  axios.get.mockReset();
  axios.put.mockReset();
  axios.post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(data = SETTINGS) {
  axios.get.mockResolvedValue({ data });
  await act(async () => {
    root.render(<AiProviderPanel />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("ayar formu sağlayıcı ve model listesini göstermez", async () => {
  await show();
  const text = host.textContent || "";
  expect(host.querySelector("[data-testid='ai-provider-picks']")).toBeNull();
  expect(host.querySelector("[data-testid='ai-advisor-model']")).toBeNull();
  expect(host.querySelector("[data-testid='ai-extract-model']")).toBeNull();
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelector("[data-testid='ai-api-key']")).toBeNull();
  expect(host.querySelector("[data-testid='ai-key-saved']")).not.toBeNull();
  expect(text).not.toMatch(/OpenAI|Anthropic|Claude|Gemini|Emergent|GPT|gpt-4|gpt-5/i);
});

test("kayıt sağlayıcı ve model değerini göndermez", async () => {
  await show();
  axios.put.mockResolvedValue({ data: { ...SETTINGS, key_hint: "wxyz" } });
  axios.post.mockResolvedValue({ data: { ok: true, reason: "", message: "Yapay zekâ bağlantısı doğrulandı." } });
  await act(async () => {
    host.querySelector("[data-testid='ai-save']").click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(axios.put).toHaveBeenCalledTimes(1);
  const body = axios.put.mock.calls[0][1];
  expect(body).toEqual({ enabled: true, api_key: undefined });
  expect(body).not.toHaveProperty("provider");
  expect(body).not.toHaveProperty("advisor_model");
  expect(body).not.toHaveProperty("extract_model");
});

test("özel uç noktada adres kalır, model alanı görünmez", async () => {
  await show({
    ...SETTINGS,
    provider: "custom",
    advisor_model: "yerel-model",
    extract_model: "yerel-model",
    base_url: "https://ornek.example/v1",
    has_key: false,
    key_hint: "",
  });
  expect(host.querySelector("[data-testid='ai-base-url']").value).toBe("https://ornek.example/v1");
  expect(host.querySelector("[data-testid='ai-advisor-model']")).toBeNull();
  expect(host.querySelector("[data-testid='ai-api-key']")).not.toBeNull();
  const text = host.textContent || "";
  expect(text).not.toMatch(/OpenAI|Claude|Gemini|GPT/i);
  axios.put.mockResolvedValue({ data: { ...SETTINGS, provider: "custom", base_url: "https://ornek.example/v1", advisor_model: "yerel-model", extract_model: "yerel-model" } });
  axios.post.mockResolvedValue({ data: { ok: true, message: "Yapay zekâ bağlantısı doğrulandı." } });
  await act(async () => {
    host.querySelector("[data-testid='ai-save']").click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  const body = axios.put.mock.calls[0][1];
  expect(body.base_url).toBe("https://ornek.example/v1");
  expect(body).not.toHaveProperty("provider");
  expect(body).not.toHaveProperty("advisor_model");
  expect(body).not.toHaveProperty("extract_model");
});
