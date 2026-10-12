#!/usr/bin/env node
/**
 * Plays the main path in a headless browser and fails on the things unit tests
 * cannot see.
 *
 *   pnpm build && pnpm ui:check
 *
 * Checks, at 360 px and 390 px wide and on desktop:
 *   - no horizontal page scroll on any screen, before and after interacting
 *   - the main call to action is inside the first screen
 *   - a reload in the middle of a session restores it (step, plan, ticks)
 *   - serving scaling and the protein target recompute without a request
 *   - once loaded, the app opens and shows the saved plan with the network off
 *   - no console errors
 *
 * With --shots <dir> it also saves a full-page PNG of every screen for review.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const port = 3281;
const base = `http://localhost:${port}`;
const shotsAt = process.argv.indexOf("--shots");
const shotDir = shotsAt === -1 ? null : process.argv[shotsAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
  stdio: "ignore",
  detached: true,
});
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);

for (let i = 0; ; i++) {
  try {
    await fetch(base);
    break;
  } catch {
    if (i > 80) throw new Error("Server did not start. Run `pnpm build` first.");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

async function noSideScroll(page, label) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(scroll <= client, `${label}: no horizontal scroll (${scroll} <= ${client})`);
}

async function inFirstScreen(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  const height = page.viewportSize().height;
  check(
    Boolean(box) && box.y >= 0 && box.y + box.height <= height,
    `${label}: "${selector}" is inside the first screen`,
  );
}

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
}

async function run(browser, name, viewport, sampleTitle) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(base, { waitUntil: "networkidle" });
  await noSideScroll(page, `${name} fridge`);
  await inFirstScreen(page, `text=${sampleTitle}`, `${name} fridge`);
  await shot(page, `${name}-1-fridge`);

  await page.click(`text=${sampleTitle}`);
  await page.waitForSelector("text=Is this what you have?");
  await noSideScroll(page, `${name} confirm`);
  await inFirstScreen(page, "text=Plan my week", `${name} confirm`);

  // Edit a row, add a row, remove a row.
  await page.locator("button:has-text('Edit')").first().click();
  await page.locator("input[inputmode='decimal']").first().fill("750");
  await page.click("button:has-text('Save')");
  await page.click("text=Add something the scan missed");
  await page
    .locator("input[placeholder='e.g. red lentils']")
    .fill("a very long ingredient name that should wrap not overflow");
  await page.click("button:has-text('Add to the list')");
  await noSideScroll(page, `${name} confirm after editing`);
  await shot(page, `${name}-2-confirm`);

  await page.click("text=Plan my week");
  await page.waitForSelector("text=Checked by code");
  await noSideScroll(page, `${name} week`);
  await shot(page, `${name}-3-week`);

  // Raising the protein target far above the plan must flag days without any request.
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests += 1;
  });
  const more = page.locator("button[aria-label^='More: Protein target']").first();
  for (let i = 0; i < 12; i++) await more.click();
  await page.waitForSelector("text=/\\d+ g short/");
  check(
    (await page.locator("text=/0 of 7 days reach/").count()) > 0,
    `${name} week: raising the protein target re-runs the check in the browser`,
  );
  const fewer = page.locator("button[aria-label^='Fewer: Protein target']").first();
  for (let i = 0; i < 12; i++) await fewer.click();
  await noSideScroll(page, `${name} week after changing the target`);

  // Open a recipe and scale it.
  await page.locator("main ol button").first().click();
  await page.waitForSelector("text=Portions to make");
  const visibleCard = page.locator("article:visible").first();
  const before = await visibleCard.locator("ul li span.num").first().innerText();
  await visibleCard.locator("button[aria-label^='More: Portions']").click();
  const after = await visibleCard.locator("ul li span.num").first().innerText();
  check(before !== after, `${name} recipe: scaling changes quantities (${before} -> ${after})`);
  await noSideScroll(page, `${name} recipe`);
  await shot(page, `${name}-4-recipe`);
  check(requests === 0, `${name}: scaling and re-checking made no API request`);

  const back = page.locator("button:has-text('Back to the week'):visible");
  if ((await back.count()) > 0) await back.first().click();
  await page.click("text=Open the grocery list");
  await page.waitForSelector("text=in the basket");
  await page.locator("main input[type=checkbox]").nth(0).check();
  await page.locator("main input[type=checkbox]").nth(2).check();
  await noSideScroll(page, `${name} groceries`);
  await shot(page, `${name}-5-groceries`);

  // Reload mid-session: same step, same ticks.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=in the basket");
  const ticked = await page.locator("main input[type=checkbox]:checked").count();
  check(ticked === 2, `${name}: a reload keeps the step and the two ticked items (${ticked})`);
  check(
    (await page.locator("text=/2 of \\d+ in the basket/").count()) === 1,
    `${name}: the basket count survives the reload`,
  );

  // Offline: wait for the service worker, cut the network, reload.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  const offlineOk = await page
    .waitForSelector("text=in the basket", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check(offlineOk, `${name}: the saved grocery list opens with the network off`);
  if (offlineOk) {
    await page.click("nav >> text=Week");
    const weekOk = await page
      .waitForSelector("text=Checked by code", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(weekOk, `${name}: the week and its macros render offline`);
  }
  await context.setOffline(false);

  const real = errors.filter(
    (text) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(text),
  );
  check(real.length === 0, `${name}: no console errors${real.length ? `: ${real[0]}` : ""}`);
  await context.close();
}

const browser = await chromium.launch();
try {
  await run(browser, "360", { width: 360, height: 740 }, "The weeknight fridge");
  await run(browser, "390", { width: 390, height: 844 }, "The vegetarian fridge");
  await run(browser, "desktop", { width: 1280, height: 800 }, "The high-protein fridge");
} finally {
  await browser.close();
  stop();
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll UI checks passed.");
process.exit(failures.length ? 1 : 0);
