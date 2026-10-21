import { ApiHttpError } from "../api/errors";
import {
  isAtolyeAccount,
  isOperatorSessionError,
  isSessionExpired,
  isValidPin,
  operatorHeaders,
  unlockErrorMessage,
} from "./shopfloorOperatorSession";

test("isValidPin accepts only four digits", () => {
  expect(isValidPin("123")).toBe(false);
  expect(isValidPin("12345")).toBe(false);
  expect(isValidPin("12a4")).toBe(false);
  expect(isValidPin(" 1234")).toBe(false);
  expect(isValidPin("5829")).toBe(true);
  expect(isValidPin(5829)).toBe(false);
});

test("isAtolyeAccount matches account_type atolye", () => {
  expect(isAtolyeAccount({ account_type: "atolye" })).toBe(true);
  expect(isAtolyeAccount({ account_type: "standard" })).toBe(false);
  expect(isAtolyeAccount(null)).toBe(false);
  expect(isAtolyeAccount(undefined)).toBe(false);
});

test("isSessionExpired compares expires_at with now", () => {
  const session = { token: "t", expires_at: "2026-01-02T00:00:00.000Z" };
  expect(isSessionExpired(session, new Date("2026-01-01T00:00:00.000Z"))).toBe(false);
  expect(isSessionExpired(session, new Date("2026-01-02T00:00:00.000Z"))).toBe(true);
  expect(isSessionExpired(session, new Date("2026-01-03T00:00:00.000Z"))).toBe(true);
  expect(isSessionExpired(null, new Date())).toBe(true);
  expect(isSessionExpired({}, new Date())).toBe(true);
  expect(isSessionExpired({ expires_at: "" }, new Date())).toBe(true);
});

test("operatorHeaders returns the shopfloor header only when a token exists", () => {
  expect(operatorHeaders(null)).toEqual({});
  expect(operatorHeaders({ token: "" })).toEqual({});
  expect(operatorHeaders({ token: "tok-abc" })).toEqual({ "X-Shopfloor-Operator": "tok-abc" });
});

test("unlockErrorMessage maps remaining attempts, lock and format errors", () => {
  const wrongPin = "PIN hatalı: 2 deneme hakkınız kaldı — 5 hatalı denemede 15 dk kilitlenir";
  expect(unlockErrorMessage({
    response: { status: 401, data: { detail: "yanlış", remaining_attempts: 2 } },
  })).toBe(wrongPin);
  expect(unlockErrorMessage(new ApiHttpError(
    401,
    "yanlış",
    "yanlış",
    { detail: "yanlış", remaining_attempts: 2 },
  ))).toBe(wrongPin);
  expect(unlockErrorMessage({
    response: { status: 423, data: { detail: "12 dk sonra tekrar deneyin", remaining_attempts: 0 } },
  })).toBe("12 dk sonra tekrar deneyin");
  expect(unlockErrorMessage(new ApiHttpError(
    429,
    "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.",
    "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.",
    { detail: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." },
  ))).toBe("Çok fazla deneme. Lütfen daha sonra tekrar deneyin.");
  expect(unlockErrorMessage({
    response: { status: 400, data: { detail: "PIN 4 haneli olmalı; yöneticinizden yeni PIN isteyin." } },
  })).toBe("PIN 4 haneli olmalı; yöneticinizden yeni PIN isteyin.");
  expect(unlockErrorMessage({ response: { status: 500, data: {} } })).toBe("PIN doğrulanamadı.");
  expect(isOperatorSessionError({
    response: { status: 401, data: { detail: "Operatör oturumu geçersiz veya süresi doldu." } },
  })).toBe(true);
  expect(isOperatorSessionError(new ApiHttpError(
    403,
    "Operatör oturumu geçersiz veya süresi doldu.",
    "Operatör oturumu geçersiz veya süresi doldu.",
    { detail: "Operatör oturumu geçersiz veya süresi doldu." },
  ))).toBe(true);
  expect(isOperatorSessionError({
    response: { status: 401, data: { detail: "PIN hatalı", remaining_attempts: 2 } },
  })).toBe(false);
  expect(isOperatorSessionError(new ApiHttpError(400, "format", "format", { detail: "format" }))).toBe(false);
});
