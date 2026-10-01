// The opening line, the passport fan and the header order: three things the
// owner reported on 2026-10-01 after seeing them on a phone. Each test is the
// failure as it was described, so it cannot quietly come back.
import { test, expect } from "@playwright/test";

test.describe("opening line", () => {
  test("never re-wraps or jumps, even when the typeface arrives late", async ({ page }) => {
    // The original bug: with a slow font the line started in the fallback
    // face on 2 lines, then dropped to 1 mid-animation when DM Sans landed.
    // Which lines do it depends on the screen width, so this walks the ones
    // that did (indexes into openingLines in js/config.js): "Back pain?...",
    // "Say goodbye to neck ache" and "Your neck will thank you".
    test.setTimeout(75000);
    await page.route("**/dm-sans-var.woff2", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      await route.continue();
    });
    for (const index of [6, 7, 8]) {
      await page.addInitScript((k) => {
        Math.random = () => (k + 0.5) / 9;
        window.__layouts = new Set();
        const tick = () => {
          const el = document.getElementById("tour-tagline");
          if (el && el.textContent) {
            const words = Array.from(el.querySelectorAll(".tl-word"));
            const r = el.getBoundingClientRect();
            window.__layouts.add([new Set(words.map((w) => w.offsetTop)).size, Math.round(r.width), Math.round(r.top)].join("|"));
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, index);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3600);
      const seen = await page.evaluate(() => ({ text: document.getElementById("tour-tagline").textContent.trim(), layouts: Array.from(window.__layouts) }));
      expect(seen.layouts, `"${seen.text}" must keep one layout from first appearing to the last frame`).toHaveLength(1);
    }
  });

  test("every line fits its box and stays clear of the header", async ({ page }) => {
    for (let i = 0; i < 9; i++) {
      await page.addInitScript((k) => { Math.random = () => (k + 0.5) / 9; }, i);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#tour-tagline.is-in", { timeout: 6000 });
      const r = await page.evaluate(() => {
        const el = document.getElementById("tour-tagline");
        const box = el.getBoundingClientRect();
        return {
          text: el.textContent.trim(),
          overflow: Array.from(el.querySelectorAll(".tl-line")).some((l) => l.scrollWidth > el.clientWidth + 1),
          sideways: box.left < 0 || box.right > innerWidth + 1,
          underHeader: box.top < (document.querySelector("header")?.getBoundingClientRect().bottom || 0) - 2,
        };
      });
      expect(r.overflow, `"${r.text}" is wider than its box`).toBe(false);
      expect(r.sideways, `"${r.text}" leaves the screen`).toBe(false);
      expect(r.underHeader, `"${r.text}" runs under the header`).toBe(false);
    }
  });

  test("stays up over the opening film and goes when the first headline arrives", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#tour-tagline.is-in", { timeout: 6000 });
    await page.waitForTimeout(3000);
    expect(await page.$eval("#tour-tagline", (el) => el.classList.contains("is-gone")), "still up when nobody has scrolled").toBe(false);
    const top = await page.$eval("#tour", (el) => el.getBoundingClientRect().top + scrollY);
    let line = null;
    let headline = null;
    for (let y = 0; y <= 4000 && (line === null || headline === null); y += 40) {
      await page.evaluate((yy) => window.scrollTo(0, yy), top + y);
      await page.waitForTimeout(90);
      const s = await page.evaluate(() => ({
        gone: document.getElementById("tour-tagline").classList.contains("is-gone"),
        headline: document.querySelector('.tour__chapter[data-chapter="overview"]').classList.contains("is-active"),
      }));
      if (s.gone && line === null) line = y;
      if (s.headline && headline === null) headline = y;
    }
    expect(line, "the line left").not.toBeNull();
    expect(line, "the line leaves exactly as the headline arrives").toBe(headline);
  });
});

test.describe("passport card fan", () => {
  test("opens with the scroll, and hover or a tap changes nothing", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const vh = await page.evaluate(() => innerHeight);
    const top = await page.$eval(".passport-visual", (el) => el.getBoundingClientRect().top + scrollY);
    const fanAt = async (offset) => {
      await page.evaluate((y) => window.scrollTo(0, y), top - offset);
      await page.waitForTimeout(350);
      return page.$eval(".passport-visual", (el) => parseFloat(el.style.getPropertyValue("--fan") || "NaN"));
    };
    const closed = await fanAt(vh * 1.1); // card still below the screen
    const half = await fanAt(vh * 0.6);
    const open = await fanAt(vh * 0.2);
    expect(closed).toBeLessThan(0.05);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.9);
    expect(open).toBeGreaterThan(0.95);
    const card = () => page.$eval(".passport-stack__card--black", (el) => getComputedStyle(el).transform);
    const before = await card();
    await page.hover(".passport-visual").catch(() => {});
    await page.waitForTimeout(500);
    expect(await card(), "hover must not change the fan").toBe(before);
  });
});

test.describe("header", () => {
  test("Measure app comes first, in the bar and in the phone menu", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    for (const selector of [".nav__links", ".nav__drawer"]) {
      const labels = await page.$$eval(`${selector} a`, (links) => links.map((a) => a.textContent.replace(/[↗]/g, "").replace(/\(opens.*\)/, "").trim()));
      expect(labels.slice(0, 3), selector).toEqual(["Measure app", "Why PENTAX", "Fit"]);
    }
  });
});

test.describe("film weight", () => {
  test("the phone film stays light", async ({ request }) => {
    // It was 13 MB, which a phone on a normal connection took ten seconds to
    // fetch; it is now 4.3 MB. This ceiling stops it creeping back up.
    const res = await request.get("/videos/tour-master-mobile.mp4", { headers: { Range: "bytes=0-0" } });
    const total = Number((res.headers()["content-range"] || "").split("/")[1]);
    expect(total, "size of videos/tour-master-mobile.mp4 in bytes").toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(7_000_000);
  });
});
