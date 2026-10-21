import { toast } from "sonner";
import { notifyOrderSyncWarning, orderSyncWarningText } from "./orderSyncWarning";

jest.mock("sonner", () => ({ toast: { warning: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  toast.warning.mockClear();
});

test("reads the skipped sync warning", () => {
  const text = "Ürün veya miktar değişikliği toplama açık ya da sevk edilmiş siparişe uygulanmadı.";
  expect(orderSyncWarningText({ order_sync_warning: `  ${text}  ` })).toBe(text);
  expect(orderSyncWarningText({ message: "güncellendi" })).toBe("");
  expect(orderSyncWarningText(null)).toBe("");
});

test("shows the warning with the existing toast", () => {
  const text = "Ürün veya miktar değişikliği toplama açık ya da sevk edilmiş siparişe uygulanmadı.";
  notifyOrderSyncWarning({ order_sync_warning: text });
  expect(toast.warning).toHaveBeenCalledWith(text);
  notifyOrderSyncWarning({ message: "güncellendi" });
  expect(toast.warning).toHaveBeenCalledTimes(1);
});
