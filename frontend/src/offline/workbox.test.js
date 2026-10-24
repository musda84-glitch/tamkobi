const fs = require("fs");
const path = require("path");

test("index.html network-first, hash'li statik dosyalar cache-first", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../craco.config.js"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "registerServiceWorker.js"), "utf8");
  expect(src).toMatch(/GenerateSW/);
  expect(src).toMatch(/handler:\s*"NetworkFirst"/);
  expect(src).toMatch(/\/index\\\.html\$\//);
  expect(src).toMatch(/index\\\.html\$/);
  expect(src).not.toMatch(/navigateFallback:\s*"\/index\.html"/);
  expect(src).toMatch(/CacheFirst/);
  expect(src).toMatch(/\/api/);
  expect(src).toMatch(/skipWaiting:\s*true/);
  expect(src).toMatch(/clientsClaim:\s*true/);
  expect(sw).toMatch(/updateViaCache:\s*"none"/);
});
