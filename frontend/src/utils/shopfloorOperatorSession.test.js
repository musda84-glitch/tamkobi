import {
  clearOperatorSession,
  isAtolyeAccount,
  isOperatorSessionError,
  isSessionExpired,
  isValidPin,
  loadOperatorSession,
  operatorHeaders,
  operatorSessionKey,
  saveOperatorSession,
  unlockErrorMessage,
} from "./shopfloorOperatorSession";

const COMPANY = "c1";
const USER = "u1";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

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
});

test("save and load use only sessionStorage", () => {
  const orig = Storage.prototype.setItem;
  const writes = [];
  const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function spySet(key, value) {
    writes.push({ storage: this, key, value: String(value) });
    return orig.call(this, key, value);
  });
  const saved = saveOperatorSession(COMPANY, USER, {
    token: "tok-abc",
    operator_name: "Ali Usta",
    operator_type: "employee",
    operator_id: "e1",
    expires_at: "2099-01-01T00:00:00.000Z",
    pin: "5829",
  });
  expect(saved.pin).toBeUndefined();
  expect(saved.token).toBe("tok-abc");
  const key = operatorSessionKey(COMPANY, USER);
  expect(sessionStorage.getItem(key)).toContain("tok-abc");
  expect(sessionStorage.getItem(key)).not.toContain("5829");
  expect(loadOperatorSession(COMPANY, USER)).toEqual({
    token: "tok-abc",
    operator_name: "Ali Usta",
    operator_type: "employee",
    operator_id: "e1",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  expect(writes.some((row) => row.storage === sessionStorage && row.key === key)).toBe(true);
  expect(writes.filter((row) => row.storage === localStorage)).toEqual([]);
  expect(writes.every((row) => !row.value.includes("5829"))).toBe(true);
  expect(localStorage.length).toBe(0);
  setItem.mockRestore();
  clearOperatorSession(COMPANY, USER);
  expect(loadOperatorSession(COMPANY, USER)).toBeNull();
});

test("isSessionExpired compares expires_at with now", () => {
  const session = { token: "t", expires_at: "2026-01-02T00:00:00.000Z" };
  expect(isSessionExpired(session, new Date("2026-01-01T00:00:00.000Z"))).toBe(false);
  expect(isSessionExpired(session, new Date("2026-01-02T00:00:00.000Z"))).toBe(true);
  expect(isSessionExpired(session, new Date("2026-01-03T00:00:00.000Z"))).toBe(true);
  expect(isSessionExpired(null, new Date())).toBe(true);
  expect(isSessionExpired({ token: "t" }, new Date())).toBe(true);
});

test("operatorHeaders returns the shopfloor header only when a token exists", () => {
  expect(operatorHeaders(null)).toEqual({});
  expect(operatorHeaders({ token: "" })).toEqual({});
  expect(operatorHeaders({ token: "tok-abc" })).toEqual({ "X-Shopfloor-Operator": "tok-abc" });
});

test("unlockErrorMessage maps remaining attempts, lock and format errors", () => {
  expect(unlockErrorMessage({
    response: { status: 401, data: { detail: "yanlış", remaining_attempts: 2 } },
  })).toBe("PIN hatalı: 2 deneme hakkınız kaldı — 5 hatalı denemede 15 dk kilitlenir");
  expect(unlockErrorMessage({
    response: { status: 423, data: { detail: "12 dk sonra tekrar deneyin", remaining_attempts: 0 } },
  })).toBe("12 dk sonra tekrar deneyin");
  expect(unlockErrorMessage({
    response: { status: 429, data: { detail: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." } },
  })).toBe("Çok fazla deneme. Lütfen daha sonra tekrar deneyin.");
  expect(unlockErrorMessage({
    response: { status: 400, data: { detail: "PIN 4 haneli olmalı; yöneticinizden yeni PIN isteyin." } },
  })).toBe("PIN 4 haneli olmalı; yöneticinizden yeni PIN isteyin.");
  expect(isOperatorSessionError({
    response: { status: 401, data: { detail: "Operatör oturumu geçersiz veya süresi doldu." } },
  })).toBe(true);
  expect(isOperatorSessionError({
    response: { status: 403, data: { detail: "Operatör oturumu geçersiz veya süresi doldu." } },
  })).toBe(true);
  expect(isOperatorSessionError({
    response: { status: 401, data: { detail: "PIN hatalı", remaining_attempts: 2 } },
  })).toBe(false);
});
