// Performance budgets for the public site.
//
// The numbers below are ceilings with headroom, not targets: they exist to
// catch a regression (an unoptimised hero image, a render-blocking script, a
// video that loads eagerly on every device), not to police small drifts.
import { test, expect } from "@playwright/test";

test.describe("performance", () => {
  test("largest contentful paint is quick", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const lcp = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let last = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) last = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(last), 2500);
        })
    );
    expect(lcp, "LCP in ms").toBeLessThan(4000);
  });

  test("layout is stable (CLS)", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const cls = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 2500);
        })
    );
    expect(cls, "cumulative layout shift").toBeLessThan(0.1);
  });

  test("first view stays light: no video and few bytes before scrolling", async ({ page }) => {
    const bytes = [];
    page.on("response", async (r) => {
      const url = new URL(r.url()).pathname;
      const len = Number(r.headers()["content-length"] || 0);
      bytes.push({ url, len, type: (r.headers()["content-type"] || "").split(";")[0] });
    });
    await page.goto("/", { waitUntil: "load" });

    // The ambient feature clips are preload="none" and must not be fetched
    // until they scroll into view.
    const featureClips = bytes.filter((b) => b.url.startsWith("/videos/features/"));
    expect(featureClips.map((b) => b.url), "feature clips fetched on first paint").toEqual([]);

    const nonVideo = bytes.filter((b) => !b.type.startsWith("video/"));
    const kb = nonVideo.reduce((n, b) => n + b.len, 0) / 1024;
    expect(kb, "non-video KB at load").toBeLessThan(1800);
  });

  test("scripts do not block parsing and the font is preloaded", async ({ page }) => {
    await page.goto("/");
    const head = await page.evaluate(() => ({
      blocking: [...document.querySelectorAll("script[src]")].filter(
        (s) => !s.defer && !s.async && s.type !== "module"
      ).length,
      fontPreload: !!document.querySelector('link[rel=preload][as=font]'),
      posterPreload: !!document.querySelector('link[rel=preload][as=image]'),
    }));
    expect(head.blocking, "render-blocking scripts").toBe(0);
    expect(head.fontPreload).toBe(true);
    expect(head.posterPreload).toBe(true);
  });

  test("every image declares its intrinsic size", async ({ page }) => {
    await page.goto("/");
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        // Images whose src is assigned by JS (carousel, configurator preview,
        // lightbox) start empty and are sized by a fixed-aspect container.
        .filter((i) => i.getAttribute("src"))
        .filter((i) => !i.getAttribute("width") || !i.getAttribute("height"))
        .map((i) => i.getAttribute("src"))
    );
    expect(missing, "images without width/height (cause layout shift)").toEqual([]);
  });

  test("the tour becomes scrubbable quickly, not after a long download", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    // Ready means the element has a source and enough data to seek. The full
    // in-memory copy arrives later in the background; the visitor must not
    // have to wait for it (this was a real regression once).
    const readyMs = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t0 = performance.now();
          const v = document.querySelector("#tour-video");
          if (!v) return resolve(-1);
          const check = () => {
            if (v.readyState >= 2 && v.currentSrc) return resolve(performance.now() - t0);
            if (performance.now() - t0 > 12000) return resolve(Infinity);
            requestAnimationFrame(check);
          };
          check();
        })
    );
    expect(readyMs, "ms until the tour video can be seeked").toBeLessThan(6000);
  });

  test("the phone gets the lighter film first", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone-specific source choice");
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const src = await page.evaluate(() => document.querySelector("#tour-video")?.getAttribute("src") || "");
    expect(src, "phones should stream the 540p film, not the 38MB master").toContain("tour-master-mobile");
  });
});
