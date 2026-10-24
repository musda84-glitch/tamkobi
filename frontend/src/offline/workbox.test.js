const fs = require("fs");
const path = require("path");

test("Workbox app shell ve statik dosyalar için cache-first kullanır", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../craco.config.js"), "utf8");
  expect(src).toMatch(/GenerateSW/);
  expect(src).toMatch(/CacheFirst/);
  expect(src).toMatch(/navigateFallback:\s*"\/index\.html"/);
  expect(src).toMatch(/\/api\\\//);
});
