import { convertStorageAmount, formatBytes, formatLimitMb, formatPercent, storageMbFromForm } from "./storageFormat";

test("Turkish comma decimals for bytes, limits and percents", () => {
  expect(formatBytes(17436343)).toBe("16,6 MB");
  expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  expect(formatLimitMb(5120)).toBe("5 GB");
  expect(formatLimitMb(16)).toBe("16 MB");
  expect(formatLimitMb(0)).toBe("Sınırsız");
  expect(formatPercent(16.6)).toBe("%16,6");
});

test("form amount converts between MB and GB", () => {
  expect(storageMbFromForm("5", "gb")).toBe(5120);
  expect(storageMbFromForm("10,5", "gb")).toBe(10752);
  expect(storageMbFromForm("", "mb")).toBeNull();
  expect(convertStorageAmount("2048", "mb", "gb")).toBe("2");
  expect(convertStorageAmount("2", "gb", "mb")).toBe("2048");
});
