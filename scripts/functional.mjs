#!/usr/bin/env node
/**
 * Checks every feature of Mise in a headless browser against the production
 * server. Build first, then serve and run:
 *
 *   pnpm build && pnpm exec next start -p 3180
 *   pnpm functional
 *
 * Covers the three sample fridges end to end (confirm, edit, add, remove, plan,
 * week controls, recipe scaling, grocery list, reload, step navigation) at phone
 * and desktop widths, in light and dark; the key dialog; failure notices; the
 * PWA with the network off; and the demo API contracts.
 *
 * The app runs in demo mode. The script never enters a key, so no model is
 * called. After every interaction it checks for sideways scroll, and any console
 * or uncaught page error fails the run.
 *
 *   FUNCTIONAL_BASE   origin to test (default http://localhost:3180)
 *   FUNCTIONAL_SHOTS  directory for a screenshot of each key screen (optional)
 *
 * Exits 1 if any check fails.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.FUNCTIONAL_BASE ?? "http://localhost:3180";
const SHOTS = process.env.FUNCTIONAL_SHOTS ?? null;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const SAMPLES = JSON.parse(readFileSync(new URL("../lib/samples.json", import.meta.url), "utf8"));
const DIET_TEXT = {
  omnivore: "Omnivore",
  pescatarian: "Pescatarian",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
};
const THEMES = {
  light: { bg: "rgb(245, 238, 221)", accent: "rgb(53, 96, 58)" },
  dark: { bg: "rgb(22, 25, 18)", accent: "rgb(165, 207, 143)" },
};
const RUNS = [
  { name: "phone light", viewport: PHONE, theme: "light", samples: SAMPLES },
  { name: "desktop light", viewport: DESKTOP, theme: "light", samples: SAMPLES },
  { name: "phone dark", viewport: PHONE, theme: "dark", samples: SAMPLES },
  { name: "desktop dark", viewport: DESKTOP, theme: "dark", samples: [SAMPLES[0]] },
];
/** Errors that a deliberately blocked or offline request produces, and nothing else. */
const NETWORK_NOISE = /Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/;

const results = [];
const failures = [];

function check(group, feature, ok, detail = "") {
  const pass = Boolean(ok);
  results.push({ group, feature, pass });
  const line = `${pass ? "PASS" : "FAIL"}  ${group} | ${feature}${!pass && detail ? ` :: ${detail}` : ""}`;
  console.log(line);
  if (!pass) failures.push(line);
}

/** True when the locator is visible within the timeout. */
async function appears(locator, timeout = 6000) {
  try {
    await locator.filter({ visible: true }).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/** True once no native dialog is open. */
async function dialogGone(page) {
  try {
    await page.waitForFunction(() => !document.querySelector("dialog[open]"), null, {
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Fails if the page is wider than the window, which means it scrolls sideways. */
async function layout(page, group, label) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  check(group, `no sideways scroll after ${label}`, scroll <= width, `scrollWidth ${scroll} > ${width}`);
}

async function openPage(browser, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: "light", deviceScaleFactor: 1 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { context, page, errors };
}

const step = (page, label) => page.locator('nav[aria-label="Steps"] button').filter({ hasText: label });
const weekFound = (page) => appears(page.getByText("Checked by code"));

/**
 * Plans the week from the confirm step. The plan route allows 8 requests a minute
 * per client, and the whole run shares one client. Past that the app shows its
 * "Too many requests" notice; this checks the notice, waits out the window, and
 * tries again rather than bypassing the limit.
 */
async function planWeek(page, group, errors) {
  await page.getByRole("button", { name: "Plan my week" }).click();
  if (await appears(page.getByText("Too many requests"), 3000)) {
    check(
      group,
      "a plan past the request limit says so and offers Try again",
      (await appears(page.getByText("Wait a moment and try again."))) &&
        (await appears(page.getByRole("button", { name: "Try again" }))),
    );
    await page.waitForTimeout(61_000);
    await page.getByRole("button", { name: "Try again" }).click();
    // The browser logs the 429 it was sent. The notice above is the app handling it,
    // so that one log line is expected here and nothing else is excused.
    for (let i = errors.length - 1; i >= 0; i--) {
      if (/status of 429/.test(errors[i])) errors.splice(i, 1);
    }
  }
  return weekFound(page);
}
const ingredientsHeading = (page) => page.getByRole("heading", { name: "Is this what you have?" });

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Each day card's protein and energy, read from the week view. */
async function dayCards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main li")]
      .filter((li) => /^Day \d$/.test(li.querySelector("h3")?.textContent.trim() ?? ""))
      .map((li) => {
        // Drop the heading first: "Day 1" run into "113 g protein" would read as 1113.
        const heading = li.querySelector("h3").textContent;
        const text = li.textContent.slice(heading.length);
        return {
          text,
          protein: Number(text.match(/(\d+) g protein/)?.[1] ?? NaN),
          kcal: Number((text.match(/([\d,]+) kcal/)?.[1] ?? "NaN").replace(/,/g, "")),
          onTarget: /on target/i.test(text),
          short: Number(text.match(/(\d+) g short/)?.[1] ?? NaN),
        };
      }),
  );
}

/** The protein tag on each day must agree with the target, using the 90 % rule. */
function proteinTagsAgree(days, target) {
  return days.every((day) =>
    day.onTarget
      ? day.protein >= 0.9 * target - 0.5
      : day.protein <= 0.9 * target + 0.5 &&
        Math.abs(day.short - (target - day.protein)) <= 1,
  );
}

// ---------------------------------------------------------------------------
// First run: nothing read yet, the key dialog, and the photo area in demo mode.
// ---------------------------------------------------------------------------
async function firstRun(browser) {
  const group = "first run";
  const { context, page, errors } = await openPage(browser, PHONE);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    check(
      group,
      "Confirm, Week and Groceries are locked before any fridge is read",
      (await step(page, "Confirm").isDisabled()) &&
        (await step(page, "Week").isDisabled()) &&
        (await step(page, "Groceries").isDisabled()),
    );
    check(
      group,
      "Fridge is the current step",
      (await step(page, "Fridge").getAttribute("aria-current")) === "step",
    );
    check(group, "no photo input is offered in demo mode", (await page.locator('input[type="file"]').count()) === 0);
    check(
      group,
      "the photo area asks for a key instead",
      await appears(page.getByRole("button", { name: "Add a key to use your photo" })),
    );
    await layout(page, group, "first load");

    // Keyboard: the skip link is the first stop and moves to the content.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    check(group, "the skip link is the first keyboard stop and shows when focused", await skip.isVisible());
    await skip.press("Enter");
    check(group, "the skip link moves to the main content", (await page.evaluate(() => location.hash)) === "#main");

    // Theme switch both ways.
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(group, "the theme switch turns the page dark", darkBg === THEMES.dark.bg, darkBg);
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(group, "and back to the cream light theme", lightBg === THEMES.light.bg, lightBg);

    const dialog = page.locator("dialog[open]");
    const openFromBanner = async () => {
      await page.getByRole("button", { name: "Add your Anthropic API key" }).click();
      return appears(dialog);
    };
    check(group, "the banner link opens the key dialog", await openFromBanner());
    check(
      group,
      "the dialog heading names the key",
      await appears(dialog.getByRole("heading", { name: "Add your Anthropic key" })),
    );
    check(
      group,
      "the dialog links to where a key is created",
      (await dialog.getByRole("link", { name: "Create a key" }).getAttribute("href")) ===
        "https://platform.claude.com/settings/keys",
    );
    check(group, "no Remove key button when no key is set", (await dialog.getByRole("button", { name: "Remove key" }).count()) === 0);

    await dialog.locator('input[name="key"]').fill("not-a-key");
    await dialog.getByRole("button", { name: "Use this key" }).click();
    check(
      group,
      "a malformed key is refused with the reason",
      await appears(dialog.getByRole("alert")) && /start with sk-ant-/.test(await dialog.innerText()),
    );
    check(
      group,
      "the refused key leaves the app in demo mode",
      await appears(page.getByText(/pre-written examples/)),
    );
    check(
      group,
      "no key is kept in session storage",
      (await page.evaluate(() => sessionStorage.getItem("anthropic-key"))) === null,
    );
    await page.keyboard.press("Escape");
    check(group, "Escape closes the dialog", await dialogGone(page));

    await openFromBanner();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    check(group, "Cancel closes the dialog", await dialogGone(page));

    await openFromBanner();
    await page.mouse.click(5, 5);
    check(group, "a click on the backdrop closes the dialog", await dialogGone(page));

    await page.getByRole("button", { name: "Add a key to use your photo" }).click();
    check(group, "the photo area's key button also opens the dialog", await appears(dialog));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    check(group, "the dialog closes again", await dialogGone(page));
    await layout(page, group, "the key dialog");

    check(group, "no console or uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Failure notices: a scan and a plan that cannot reach the server.
// ---------------------------------------------------------------------------
async function failureNotices(browser) {
  const group = "failures";
  const { context, page, errors } = await openPage(browser, PHONE);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.route("**/api/scan", (route) => route.abort());
    await page.getByRole("button", { name: new RegExp(SAMPLES[1].title) }).click();
    check(group, "a scan that cannot reach the server says so", await appears(page.getByText("The scan did not work")));
    check(group, "the scan failure carries the network message", await appears(page.getByText("Network error. Check your connection.")));
    check(group, "a failed scan stays on the fridge step", await appears(page.getByRole("button", { name: new RegExp(SAMPLES[1].title) })));
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    check(group, "Dismiss clears the scan failure", (await page.getByText("The scan did not work").count()) === 0);
    await page.unroute("**/api/scan");
    await layout(page, group, "a failed scan");

    await page.getByRole("button", { name: new RegExp(SAMPLES[0].title) }).click();
    await appears(ingredientsHeading(page));
    await page.route("**/api/plan", (route) => route.abort());
    await page.getByRole("button", { name: "Plan my week" }).click();
    check(group, "a plan that cannot reach the server says so", await appears(page.getByText("The plan did not work")));
    check(group, "the plan failure offers Try again", await appears(page.getByRole("button", { name: "Try again" })));
    await layout(page, group, "a failed plan");
    await page.unroute("**/api/plan");
    await page.getByRole("button", { name: "Try again" }).click();
    check(group, "Try again produces the week", await weekFound(page));
    check(group, "the failure notice is gone after a retry", (await page.getByText("The plan did not work").count()) === 0);

    // A plan the demo cannot answer offers a key rather than a retry.
    await step(page, "Confirm").click();
    await page.route("**/api/plan", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            kind: "demo_miss",
            message: "Demo mode only answers the presets. Pick one of them, or add your Anthropic key to run this live.",
          },
        }),
      }),
    );
    await page.getByRole("button", { name: "Plan my week" }).click();
    check(group, "a plan the demo cannot answer says it needs a key", await appears(page.getByText("That needs a key")));
    check(
      group,
      "that notice offers Add key and no Try again",
      (await appears(page.getByRole("button", { name: "Add key", exact: true }))) &&
        (await page.getByRole("button", { name: "Try again" }).count()) === 0,
    );
    await page.getByRole("button", { name: "Add key", exact: true }).click();
    check(group, "Add key opens the key dialog", await appears(page.locator("dialog[open]")));
    await page.locator("dialog[open]").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.unroute("**/api/plan");
    await layout(page, group, "the key notice");

    const real = errors.filter((text) => !NETWORK_NOISE.test(text));
    check(group, "no errors beyond the deliberately blocked requests", real.length === 0, real.slice(0, 3).join(" | "));
    await layout(page, group, "recovering");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Cancel while a plan is being made: the confirm step stays, nothing is shown.
// ---------------------------------------------------------------------------
async function cancelPlanning(browser) {
  const group = "cancel";
  const { context, page, errors } = await openPage(browser, PHONE);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: new RegExp(SAMPLES[0].title) }).click();
    await appears(ingredientsHeading(page));
    await page.getByRole("button", { name: "Plan my week" }).click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    check(group, "a plan in progress offers Cancel", await appears(cancel, 1500));
    await cancel.click();
    await page.waitForTimeout(1200);
    check(group, "cancelling keeps the confirm step", await appears(ingredientsHeading(page)));
    check(group, "cancelling shows Plan my week again", await appears(page.getByRole("button", { name: "Plan my week" })));
    check(group, "cancelling produces no week and no failure", (await weekFound(page)) === false && (await page.getByText("Network error").count()) === 0);
    check(group, "no console or uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// The HTTP contract the page depends on. No model is called in demo mode.
// ---------------------------------------------------------------------------
function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysDeep(item, out);
    }
  }
  return out;
}

async function apiContract(browser) {
  const group = "api";
  const { context, page } = await openPage(browser, PHONE);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const nutrition = await page.request.post(`${BASE}/api/nutrition`, {
      data: { names: ["unicorn dust"] },
    });
    const nutritionBody = await nutrition.json();
    check(
      group,
      "the FoodData lookup without a key answers 200 with available false",
      nutrition.status() === 200 && nutritionBody.available === false && Object.keys(nutritionBody.foods).length === 0,
      JSON.stringify(nutritionBody),
    );

    const scan = await page.request.post(`${BASE}/api/scan`, {
      data: { demoId: "garden", sampleId: "garden" },
    });
    const scanBody = await scan.json();
    check(
      group,
      "the vegetarian scan replays its recorded list",
      scan.status() === 200 && scanBody.ok === true && scanBody.data.items.length === 18 && scanBody.meta.mode === "demo",
      `status ${scan.status()}`,
    );

    const plan = await page.request.post(`${BASE}/api/plan`, {
      data: {
        demoId: "weeknight",
        ingredients: [{ name: "chicken breast", quantity: 680, unit: "g" }],
        prefs: { diet: "omnivore", maxMinutes: 30, servings: 2, proteinTarget: 110 },
      },
    });
    const planBody = await plan.json();
    const keys = [...keysDeep(planBody.data ?? {})];
    check(
      group,
      "the plan replays with seven days and no nutrition fields from the model",
      plan.status() === 200 &&
        planBody.ok === true &&
        planBody.data.plan.days.length === 7 &&
        !keys.some((key) => /kcal|calori|protein|carb|fat|fibre|fiber|macro/i.test(key)),
      keys.join(","),
    );
    const ingredientKeys = planBody.data.plan.recipes.flatMap((recipe) =>
      recipe.ingredients.flatMap((item) => Object.keys(item)),
    );
    check(
      group,
      "recipe ingredients carry only name, quantity, unit and prep",
      ingredientKeys.every((key) => ["name", "quantity", "unit", "prep"].includes(key)),
    );

    const miss = await page.request.post(`${BASE}/api/plan`, {
      data: {
        ingredients: [{ name: "chicken breast", quantity: 680, unit: "g" }],
        prefs: { diet: "omnivore", maxMinutes: 30, servings: 2, proteinTarget: 110 },
      },
    });
    const missBody = await miss.json();
    check(
      group,
      "a plan from an unknown list says it needs a key, with no model call",
      missBody.ok === false && missBody.error.kind === "demo_miss",
      `status ${miss.status()} ${JSON.stringify(missBody.error ?? {})}`,
    );
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// PWA: manifest, icons and service worker, then a saved plan opened offline.
// ---------------------------------------------------------------------------
async function pwa(browser) {
  const group = "pwa";
  const { context, page, errors } = await openPage(browser, PHONE);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    check(group, "the page links its web manifest", manifestHref === "/manifest.webmanifest", String(manifestHref));
    const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
    check(
      group,
      "manifest is installable: standalone, root start, named Mise",
      manifest.display === "standalone" && manifest.start_url === "/" && manifest.short_name === "Mise",
      JSON.stringify({ display: manifest.display, start: manifest.start_url }),
    );
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    check(group, "manifest lists 192 px, 512 px and a maskable icon", sizes.includes("192x192") && sizes.includes("512x512") && (manifest.icons ?? []).some((icon) => icon.purpose === "maskable"));
    const iconChecks = await page.evaluate(async (icons) =>
      Promise.all(
        icons.map(async (icon) => {
          const response = await fetch(icon.src);
          return { src: icon.src, ok: response.ok, type: response.headers.get("content-type") };
        }),
      ),
    manifest.icons ?? []);
    check(
      group,
      "every manifest icon is served as a PNG",
      iconChecks.length > 0 && iconChecks.every((icon) => icon.ok && icon.type === "image/png"),
      JSON.stringify(iconChecks),
    );

    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { script: registration.active?.scriptURL ?? null, state: registration.active?.state ?? null };
    });
    check(group, "the service worker registers and activates", worker.state === "activated" && worker.script?.endsWith("/sw.js"), JSON.stringify(worker));

    // A plan made online, then the network goes away.
    await page.getByRole("button", { name: new RegExp(SAMPLES[0].title) }).click();
    await appears(ingredientsHeading(page));
    check(group, "a plan is made before going offline", await planWeek(page, group, errors));
    await page.waitForTimeout(800);
    // The first load predates control by the worker, so reload once to cache the app's files.
    await page.reload({ waitUntil: "networkidle" });
    check(group, "the saved plan reopens on a normal reload", await weekFound(page));
    await context.setOffline(true);
    errors.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    check(group, "the saved plan opens with the network off", await appears(page.getByText("Checked by code"), 8000));
    check(group, "the offline plan keeps its title", await appears(page.locator("main h1"), 4000));
    await step(page, "Groceries").click();
    check(group, "the grocery list opens offline", await appears(page.getByText(/in the basket/), 5000));
    await step(page, "Confirm").click();
    check(group, "the ingredient list opens offline", await appears(ingredientsHeading(page), 5000));
    await context.setOffline(false);
    const real = errors.filter((text) => !NETWORK_NOISE.test(text));
    check(group, "no errors while offline beyond the blocked requests", real.length === 0, real.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// One sample fridge, end to end, in one viewport and theme.
// ---------------------------------------------------------------------------
async function sampleFlow(browser, sample, run) {
  const group = `${sample.id} ${run.name}`;
  const phone = run.viewport.width < 1024;
  const palette = THEMES[run.theme];
  const { context, page, errors } = await openPage(browser, run.viewport);
  const name = `${sample.id}-${run.name.replace(/ /g, "-")}`;
  try {
    // First screen
    await page.goto(BASE, { waitUntil: "networkidle" });
    check(group, "first screen shows the headline", await appears(page.getByRole("heading", { name: /A week of meals from what is already in your fridge/ })));
    check(group, "banner says the answers are pre-written", await appears(page.getByText(/pre-written examples/)));
    if (run.theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const applied = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    check(group, `${run.theme} theme applies to the page`, applied.theme === run.theme && applied.bg === palette.bg, JSON.stringify(applied));
    await layout(page, group, "the first screen");

    // Tap the sample: its ingredient list appears.
    await page.getByRole("button", { name: new RegExp(sample.title) }).click();
    check(group, "tapping the sample opens its ingredient list", await appears(ingredientsHeading(page)));
    check(group, "the list is labelled as hand-written", await appears(page.getByText("Sample ingredient list, written by hand")));
    const current = await step(page, "Confirm").getAttribute("aria-current");
    check(group, "Confirm is the current step", current === "step");
    const accent = await page.getByRole("button", { name: "Plan my week" }).evaluate((el) => getComputedStyle(el).backgroundColor);
    check(group, "the primary button uses the herb green accent", accent === palette.accent, accent);
    await layout(page, group, "opening the sample");

    // Preferences from the sample, locked in demo mode.
    const prefs = await page.evaluate(() => {
      const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
      // A disabled fieldset disables its inputs through :disabled, not their own attribute.
      return {
        diet: radios("diet").find((input) => input.checked)?.parentElement?.textContent.trim() ?? null,
        dietLocked: radios("diet").every((input) => input.matches(":disabled")),
        minutes: radios("minutes").find((input) => input.checked)?.parentElement?.textContent.trim() ?? null,
        minutesLocked: radios("minutes").every((input) => input.matches(":disabled")),
        servings: document.querySelector('[role="group"][aria-label="People at the table"] output')?.textContent.replace(/\s/g, "") ?? null,
        protein: document.querySelector('[role="group"][aria-label^="Protein target"] output')?.textContent.replace(/\s/g, "") ?? null,
      };
    });
    check(group, `diet shows ${DIET_TEXT[sample.prefs.diet]}`, prefs.diet === DIET_TEXT[sample.prefs.diet], String(prefs.diet));
    check(group, `cook time shows ${sample.prefs.maxMinutes} min`, prefs.minutes === `${sample.prefs.maxMinutes} min`, String(prefs.minutes));
    check(group, `people shows ${sample.prefs.servings}`, prefs.servings === String(sample.prefs.servings), String(prefs.servings));
    check(group, `protein target shows ${sample.prefs.proteinTarget} g`, prefs.protein === `${sample.prefs.proteinTarget}g`, String(prefs.protein));
    check(
      group,
      "diet and cook time are locked in demo mode, with the reason shown",
      prefs.dietLocked && prefs.minutesLocked && (await appears(page.getByText(/so changing them needs a key/))),
    );
    check(
      group,
      "people and protein stay editable in demo mode",
      await page.locator('button[aria-label="More: People at the table"]').isEnabled(),
    );

    // The scanned rows: count, confidence tags, and whether all are shown.
    const editButtons = page.locator('button[aria-label^="Edit "]');
    const rowCount = await editButtons.count();
    const foundText = (await page.locator("main").innerText()).match(/(\d+) foods found/);
    check(group, `the list shows ${rowCount} rows, matching the count`, rowCount > 0 && Number(foundText?.[1]) === rowCount, `rows ${rowCount}`);
    const tags = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("main li")].filter((li) =>
        li.querySelector('button[aria-label^="Edit "]'),
      );
      return { rows: rows.length, tagged: rows.filter((li) => /(Sure|Likely|Guess)/.test(li.textContent)).length };
    });
    check(group, "every scanned row shows its confidence", tags.rows === rowCount && tags.tagged === rowCount, JSON.stringify(tags));
    await layout(page, group, "the ingredient list");

    // Edit a row: validation, save, cancel and a reload.
    const firstLabel = await editButtons.first().getAttribute("aria-label");
    const rowName = firstLabel.replace(/^Edit /, "");
    const rowItem = () =>
      page
        .locator("li")
        .filter({ has: page.getByRole("button", { name: `Edit ${rowName}`, exact: true }) })
        .first();
    await editButtons.first().click();
    const amount = page.getByLabel("Amount", { exact: true });
    check(group, `editing "${rowName}" opens its form`, await appears(amount));
    const save = page.getByRole("button", { name: "Save", exact: true });
    await amount.fill("0");
    check(group, "Save is disabled for an amount of zero", await save.isDisabled());
    await amount.fill("37");
    check(group, "Save is enabled for a valid amount", await save.isEnabled());
    await save.click();
    const edited = await rowItem().innerText();
    check(group, `saved edit shows 37 on "${rowName}" and tags it Yours`, /\b37\b/.test(edited) && /yours/i.test(edited), edited);
    await layout(page, group, "saving an edit");

    await rowItem().getByRole("button", { name: `Edit ${rowName}`, exact: true }).click();
    await amount.fill("99");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const afterCancel = await rowItem().innerText();
    check(group, "Cancel leaves the saved amount alone", /\b37\b/.test(afterCancel) && !/\b99\b/.test(afterCancel), afterCancel);

    await page.reload({ waitUntil: "networkidle" });
    check(group, "a reload keeps the confirm step", await appears(ingredientsHeading(page)));
    check(group, "a reload keeps the edited amount", /\b37\b/.test(await rowItem().innerText()));

    // Remove the last row.
    const beforeRemove = await editButtons.count();
    const removeButton = page.locator('button[aria-label^="Remove "]').last();
    const removed = (await removeButton.getAttribute("aria-label")).replace(/^Remove /, "");
    await removeButton.click();
    check(group, `removing "${removed}" drops one row`, (await editButtons.count()) === beforeRemove - 1);
    await layout(page, group, "removing a row");

    // Add a food the scan missed: the button stays off until a name is typed; Enter adds it.
    await page.getByRole("button", { name: "Add something the scan missed" }).click();
    const addSubmit = page.getByRole("button", { name: "Add to the list", exact: true });
    check(group, "Add stays disabled until a food is named", await addSubmit.isDisabled());
    const food = page.getByLabel("Food", { exact: true });
    await food.fill("unicorn dust");
    check(group, "Add enables once a food is named", await addSubmit.isEnabled());
    const addAmount = page.getByLabel("Amount", { exact: true });
    await addAmount.fill("0");
    check(group, "Add stays disabled for an amount of zero", await addSubmit.isDisabled());
    await addAmount.fill("2");
    check(group, "Add enables again for a valid amount", await addSubmit.isEnabled());
    // The unit select's accessible name includes its options, so target the only select on the page.
    await page.locator("select").first().selectOption("g");
    await food.press("Enter");
    check(group, "Enter adds the food and closes the form", await appears(page.getByRole("button", { name: "Add something the scan missed" })));
    check(group, "the added food is a new row", (await editButtons.count()) === beforeRemove);
    const unmatched = page.locator("li").filter({ hasText: "unicorn dust" }).first();
    const unmatchedText = await unmatched.innerText();
    check(
      group,
      "a food not in the nutrition data is flagged, and says it is left out of the totals",
      /Not in the nutrition data: it will not count toward the nutrition totals/.test(unmatchedText),
    );
    check(group, "the unit picked in the form is kept (2 g)", /\b2 g\b/.test(unmatchedText), unmatchedText);
    await layout(page, group, "adding a food");

    // Plan the week.
    check(group, "Plan my week opens the week view", await planWeek(page, group, errors));
    check(group, "the plan is labelled as hand-written", await appears(page.getByText("Sample plan, written by hand")));
    await shot(page, `${name}-week`);
    await layout(page, group, "planning the week");

    // Seven days, three meals each, and the checks.
    let days = await dayCards(page);
    check(group, "the week has seven days", days.length === 7, `${days.length} days`);
    const meals = await page.locator("main ol button").count();
    const dayTexts = days.map((day) => day.text);
    check(
      group,
      "each day has breakfast, lunch and dinner",
      meals === 21 && dayTexts.every((text) => /Breakfast/.test(text) && /Lunch/.test(text) && /Dinner/.test(text)),
      `meal buttons ${meals}`,
    );
    check(
      group,
      "each day shows protein, calories, carbs, fat and fibre",
      days.every((day) => day.protein > 0 && day.kcal > 0) &&
        dayTexts.every((text) => /carbs \d+ g/.test(text) && /fat \d+ g/.test(text) && /fibre \d+ g/.test(text)),
    );
    const target = sample.prefs.proteinTarget;
    check(group, `each day's protein tag matches the ${target} g target`, proteinTagsAgree(days, target), JSON.stringify(days.map((d) => [d.protein, d.onTarget, d.short])));

    const checksText = await page.locator('section[aria-labelledby="checks-title"]').textContent();
    check(
      group,
      "all six code checks pass",
      (checksText.match(/Passed\./g) ?? []).length === 6 && !/Needs attention/.test(checksText),
      checksText.slice(0, 200),
    );
    check(
      group,
      `the cook time check uses the ${sample.prefs.maxMinutes}-minute limit`,
      checksText.includes(`(limit ${sample.prefs.maxMinutes})`),
    );
    const reachNow = (await page.locator("main").innerText()).match(/(\d+) of 7 days reach (\d+) g per person/);
    const onTargetNow = days.filter((day) => day.onTarget).length;
    check(group, "the protein check counts the days that reach the target", Boolean(reachNow) && Number(reachNow[1]) === onTargetNow && Number(reachNow[2]) === target, reachNow?.[0]);

    // The average day is the mean of the seven days (code, not the model).
    const averageText = await page.locator("main li", { hasText: "An average day" }).first().textContent();
    const averageProtein = Number(averageText.match(/(\d+) g protein per person/)?.[1]);
    const averageKcal = Number((averageText.match(/([\d,]+) kcal/)?.[1] ?? "NaN").replace(/,/g, ""));
    const meanProtein = days.reduce((sum, day) => sum + day.protein, 0) / days.length;
    const meanKcal = days.reduce((sum, day) => sum + day.kcal, 0) / days.length;
    check(
      group,
      "the average day is the mean of the week",
      Math.abs(averageProtein - meanProtein) <= 1.5 && Math.abs(averageKcal - meanKcal) <= 1.5,
      `protein ${averageProtein} vs ${meanProtein.toFixed(1)}, kcal ${averageKcal} vs ${meanKcal.toFixed(1)}`,
    );

    if (phone) {
      check(group, "on a phone the recipe stays closed until a meal is tapped", !(await appears(page.locator('aside[aria-label="Recipe"] article'), 800)));
    } else {
      check(group, "on desktop a recipe sits beside the week", await appears(page.locator('aside[aria-label="Recipe"] article')));
    }

    // Protein target: step up, check the re-run, go to the limit, come back.
    const proteinGroup = page.locator('[role="group"][aria-label^="Protein target"]');
    const moreProtein = page.locator('button[aria-label^="More: Protein target"]');
    const fewerProtein = page.locator('button[aria-label^="Fewer: Protein target"]');
    const readTarget = async () => Number((await proteinGroup.locator("output").textContent()).replace(/\D/g, ""));
    check(group, `the week shows the ${target} g target`, (await readTarget()) === target);
    for (let i = 0; i < 5; i++) await moreProtein.click();
    const raised = target + 25;
    check(group, `protein target steps up by 5 g to ${raised}`, (await readTarget()) === raised);
    const raisedDays = await dayCards(page);
    const raisedReach = (await page.locator("main").innerText()).match(/(\d+) of 7 days reach (\d+) g per person/);
    check(
      group,
      "raising the target re-runs the protein check in the browser, with no request",
      Boolean(raisedReach) && Number(raisedReach[2]) === raised && Number(raisedReach[1]) === raisedDays.filter((d) => d.onTarget).length,
      raisedReach?.[0],
    );
    check(group, "days below the new target are marked short", proteinTagsAgree(raisedDays, raised));
    await layout(page, group, "raising the protein target");
    let guard = 0;
    while (guard++ < 80 && (await moreProtein.isEnabled())) await moreProtein.click();
    check(group, "protein target stops at 250 g", (await readTarget()) === 250 && (await moreProtein.isDisabled()));
    guard = 0;
    while (guard++ < 80 && (await readTarget()) > target) await fewerProtein.click();
    check(group, `protein target returns to ${target} g`, (await readTarget()) === target);

    // People: step up, clamp at both ends, return.
    const peopleGroup = page.locator('[role="group"][aria-label="People at the table"]');
    const morePeople = page.locator('button[aria-label="More: People at the table"]');
    const fewerPeople = page.locator('button[aria-label="Fewer: People at the table"]');
    const readPeople = async () => Number(await peopleGroup.locator("output").textContent());
    const people0 = await readPeople();
    await morePeople.click();
    check(group, `people goes up from ${people0} to ${people0 + 1}`, (await readPeople()) === people0 + 1);
    guard = 0;
    while (guard++ < 12 && (await morePeople.isEnabled())) await morePeople.click();
    check(group, "people stops at 8", (await readPeople()) === 8 && (await morePeople.isDisabled()));
    guard = 0;
    while (guard++ < 12 && (await fewerPeople.isEnabled())) await fewerPeople.click();
    check(group, "people stops at 1", (await readPeople()) === 1 && (await fewerPeople.isDisabled()));
    guard = 0;
    while (guard++ < 12 && (await readPeople()) < people0) await morePeople.click();
    check(group, `people returns to ${people0}`, (await readPeople()) === people0);
    await layout(page, group, "changing people");

    // Recipe card: open a meal, scale it with + and -, check per-serving holds steady.
    await page.locator("main ol button").first().click();
    const aside = page.locator('aside[aria-label="Recipe"]');
    check(group, "tapping a meal opens its recipe card", await appears(aside.getByText("Portions to make")));
    if (phone) {
      check(group, "on a phone the recipe takes over the screen", !(await appears(page.getByText("Checked by code"), 800)));
      check(group, "a phone recipe offers Back to the week", await appears(page.getByRole("button", { name: "Back to the week" })));
    }
    await shot(page, `${name}-recipe`);
    await layout(page, group, "opening a recipe");
    const portionsGroup = aside.locator('[role="group"][aria-label^="Portions of"]');
    const portions = async () => Number(await portionsGroup.locator("output").textContent());
    const firstQuantity = aside.locator("article ul li span.num").first();
    const perServing = async () =>
      Number(
        ((await aside.locator('section[aria-label="Nutrition per serving"]').textContent()).match(/Calories\s*([\d,]+)/)?.[1] ?? "NaN").replace(/,/g, ""),
      );
    const portions0 = await portions();
    const quantity0 = await firstQuantity.textContent();
    const kcal0 = await perServing();
    const reset = aside.getByRole("button", { name: /^Reset to/ });
    await aside.getByRole("button", { name: /^More: Portions of/ }).click();
    const portions1 = await portions();
    const quantity1 = await firstQuantity.textContent();
    const kcal1 = await perServing();
    check(group, `servings + raises the portions from ${portions0} to ${portions1}`, portions1 === portions0 + 1);
    check(group, `scaling changes the first ingredient (${quantity0.trim()} to ${quantity1.trim()})`, quantity1 !== quantity0);
    check(group, `per-serving calories hold steady when scaling (${kcal0} to ${kcal1})`, kcal0 > 0 && Math.abs(kcal1 - kcal0) <= 2, `${kcal0} vs ${kcal1}`);
    check(group, `the batch line follows the new portions (${portions1})`, await appears(aside.getByText(`Whole batch of ${portions1}:`)));
    check(group, "a Reset link appears once the portions are changed", await appears(reset));
    await reset.click();
    check(group, `Reset returns to ${portions0} portions`, (await portions()) === portions0);
    check(group, "after a reset the Reset link is gone", (await reset.count()) === 0);
    const fewer = aside.getByRole("button", { name: /^Fewer: Portions of/ });
    if (portions0 > 1) {
      await fewer.click();
      check(group, `servings - lowers the portions to ${portions0 - 1}`, (await portions()) === portions0 - 1);
      await reset.click();
      check(group, `Reset from ${portions0 - 1} returns to ${portions0}`, (await portions()) === portions0);
    } else {
      check(group, "servings - is disabled at one portion", await fewer.isDisabled());
    }
    const counted = (await aside.textContent()).match(/All (\d+) ingredients counted|(\d+) of (\d+) ingredients counted/);
    const listed = await aside.locator('section[aria-label="Ingredients"] li').count();
    check(group, `the nutrition panel counts all ${listed} listed ingredients`, Number(counted?.[1] ?? counted?.[3]) === listed, counted?.[0]);
    await layout(page, group, "scaling a recipe");

    if (phone) {
      await page.getByRole("button", { name: "Back to the week" }).click();
      check(group, "Back to the week returns to the week", await weekFound(page));
    }

    // Groceries
    await page.getByRole("button", { name: "Open the grocery list" }).click();
    check(group, "the grocery list opens", await appears(page.getByRole("heading", { name: "Grocery list" })));
    // The people stepper lives on the week view; it was restored to people0 above.
    const servingsNow = people0;
    const body = await page.locator("main").innerText();
    const peopleWord = servingsNow === 1 ? "person" : "people";
    check(group, `the list is for ${servingsNow} ${peopleWord}`, body.includes(`For ${servingsNow} ${peopleWord}, seven days.`));
    const basket = body.match(/(\d+) of (\d+) in the basket/);
    const total = Number(basket?.[2]);
    check(group, "the basket starts empty and has items", Boolean(basket) && Number(basket[1]) === 0 && total > 0, basket?.[0]);
    const aisles = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-labelledby^="aisle-"]')].map((section) => ({
        label: section.querySelector("h2")?.childNodes[0]?.textContent ?? "",
        shown: Number(section.querySelector("h2 span")?.textContent),
        rows: section.querySelectorAll("li").length,
      })),
    );
    check(
      group,
      "items are grouped by aisle, each with its own count",
      aisles.length >= 3 && aisles.every((aisle) => aisle.shown === aisle.rows),
      JSON.stringify(aisles.map((a) => [a.label, a.shown, a.rows])),
    );
    check(group, "every item to buy sits in exactly one aisle", aisles.reduce((sum, aisle) => sum + aisle.rows, 0) === total);
    check(group, "Produce is one of the aisles", aisles.some((aisle) => aisle.label === "Produce"));
    check(group, "the perishables panel is shown", await appears(page.getByRole("heading", { name: "Use these first" })));
    await shot(page, `${name}-groceries`);
    await layout(page, group, "the grocery list");

    const boxes = page.locator("main input[type=checkbox]");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    check(group, "ticking two items updates the basket count", await appears(page.getByText(`2 of ${total} in the basket`)));
    await page.reload({ waitUntil: "networkidle" });
    const checkedAfterReload = await page.locator("main input[type=checkbox]:checked").count();
    check(
      group,
      "ticked items survive a reload",
      checkedAfterReload === 2 && (await appears(page.getByText(`2 of ${total} in the basket`))),
      `ticked ${checkedAfterReload}`,
    );
    await page.getByRole("button", { name: "Untick everything" }).click();
    check(
      group,
      "Untick everything clears the basket",
      (await appears(page.getByText(`0 of ${total} in the basket`))) &&
        (await page.locator("main input[type=checkbox]:checked").count()) === 0,
    );
    await page.getByRole("button", { name: "Copy as text" }).click();
    check(group, "Copy as text confirms", await appears(page.getByRole("button", { name: "Copied" })));
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    check(
      group,
      "the copied list is plain text grouped by aisle",
      clipboard.includes("PRODUCE") && /\n- .+: .+/.test(clipboard) && clipboard.includes("PANTRY STAPLES"),
      clipboard.slice(0, 120),
    );

    // Already covered: a disclosure of what the fridge already holds.
    // Only some samples have anything the fridge already covers, so this checks when it is there.
    const covered = page.locator("details summary", { hasText: "Already covered" });
    if ((await covered.count()) > 0) {
      await covered.click();
      check(group, "Already covered opens to list what the fridge covers", await appears(page.locator("details[open] li")));
      await layout(page, group, "the grocery disclosure");
    }

    // The grocery step's own way back to the week.
    await page.getByRole("button", { name: "Back to the week", exact: true }).click();
    check(group, "Back to the week from the list returns to the week", await weekFound(page));

    // Step navigation keeps the session.
    await step(page, "Week").click();
    check(group, "the Week step returns to the plan", await weekFound(page));
    await step(page, "Confirm").click();
    check(group, "the Confirm step shows the list again", await appears(ingredientsHeading(page)));
    await step(page, "Fridge").click();
    check(group, "the Fridge step shows the sample fridges", await appears(page.getByRole("button", { name: new RegExp(sample.title) })));
    await step(page, "Groceries").click();
    check(group, "the Groceries step keeps the basket", await appears(page.getByText(`0 of ${total} in the basket`)));
    await layout(page, group, "moving between steps");

    check(group, "no console or uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

async function guarded(group, fn) {
  try {
    await fn();
  } catch (error) {
    check(group, "the flow ran to the end", false, String(error?.message ?? error).split("\n")[0]);
  }
}

// ---------------------------------------------------------------------------
async function reachable() {
  try {
    const response = await fetch(BASE);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`The app is not answering at ${BASE} (${error.message}). Start it with: pnpm exec next start -p 3180`);
  }
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
await reachable();
const browser = await chromium.launch();
try {
  // The API checks come first: they are the only plan calls made outside a flow,
  // and running them early keeps the plan route's per-minute allowance free.
  await guarded("api", () => apiContract(browser));
  await guarded("first run", () => firstRun(browser));
  await guarded("failures", () => failureNotices(browser));
  await guarded("cancel", () => cancelPlanning(browser));
  await guarded("pwa", () => pwa(browser));
  for (const run of RUNS) {
    for (const sample of run.samples) {
      await guarded(`${sample.id} ${run.name}`, () => sampleFlow(browser, sample, run));
    }
  }
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed} of ${results.length} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("\nFailures:");
  for (const line of failures) console.log(line);
}
process.exit(failures.length ? 1 : 0);
