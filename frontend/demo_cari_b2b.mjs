import { chromium } from "playwright";
import fs from "fs";

const OUT = "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:3025";

async function main() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(45000);

  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("admin@nexus.com");
    await page.locator('input[type="password"]').first().fill("admin123");
    await page.getByRole("button", { name: /Giriş/i }).first().click().catch(async () => {
      await page.locator('button[type="submit"]').first().click();
    });
    await page.waitForTimeout(2500);
  }

  await page.goto(BASE + "/contacts", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // open first customer row / card
  const row = page.locator('[data-testid^="contact-row-"], [data-testid^="contact-card-"], tr').filter({ hasText: /A\.Ş|Ltd|Mağaz/ }).first();
  if (await row.count()) {
    await row.click();
  } else {
    await page.locator("table tbody tr").first().click();
  }
  await page.waitForTimeout(1500);

  const tab = page.locator('[data-testid="detail-tab-b2b"]');
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1200);
    const panel = page.locator('[data-testid="contact-b2b-portal-panel"]');
    console.log("panel", await panel.isVisible().catch(() => false));
    await page.screenshot({ path: `${OUT}/cari_b2b_portal_tab.png`, fullPage: false });
  } else {
    console.log("tab missing");
    await page.screenshot({ path: `${OUT}/cari_b2b_tab_missing.png`, fullPage: false });
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
