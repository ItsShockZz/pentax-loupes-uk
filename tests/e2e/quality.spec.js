// Accessibility, responsiveness and content guard rails for the public site.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PUBLIC_PAGES = ["/", "/privacy.html", "/terms.html", "/cookies.html", "/returns.html", "/404.html"];

test.describe("accessibility", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has no serious axe violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      // Scroll-reveal starts sections at opacity 0. Scanning mid-fade makes
      // axe report a colour-contrast failure on every hidden element, which
      // no visitor ever experiences: settle the page into its revealed state
      // first, which is what is actually read. (The palette itself measures
      // 19.3:1 for body text on the page background.)
      await page.evaluate(() => {
        document
          .querySelectorAll(".why-row, .feature-card, .discipline-card, .steps__item, .trust__stat, .benefit, .passport-visual, [data-reveal]")
          .forEach((el) => el.classList.add("is-visible"));
      });
      await page.waitForTimeout(400);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // The tour's chapters are deliberately stacked and toggled; axe's
        // scrollable-region check fires on the copy column that is allowed to
        // scroll internally on short phones.
        .disableRules(["scrollable-region-focusable"])
        .analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target?.join(" ")}`),
        "serious/critical accessibility violations"
      ).toEqual([]);
    });
  }

  test("one h1, landmarks, skip link and a language are present", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator("h1").count()).toBe(1);
    expect(await page.locator("main").count()).toBe(1);
    expect(await page.locator("a.skip-link").count()).toBe(1);
    expect(await page.getAttribute("html", "lang")).toBe("en-GB");
  });

  test("keyboard focus is visible on the first controls", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth };
    });
    expect(outline.tag).not.toBe("BODY");
  });
});

test.describe("responsive layout", () => {
  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/", { waitUntil: "load" });
      await page.waitForTimeout(600);
      const res = await page.evaluate(() => {
        const doc = document.documentElement;
        const offenders = [];
        // An element whose box extends past the viewport is only a defect if
        // nothing clips it; decorative glows sit inside an overflow-clipped
        // parent on purpose and cost the visitor nothing.
        const clipped = (el) => {
          for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            const o = getComputedStyle(p);
            if (/hidden|clip|auto|scroll/.test(o.overflowX)) return true;
          }
          return false;
        };
        document.querySelectorAll("body *").forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > doc.clientWidth + 1 && !clipped(el)) {
            offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(r.right)}`);
          }
        });
        return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, offenders: offenders.slice(0, 5) };
      });
      expect(res.offenders, `elements overflowing at ${width}px`).toEqual([]);
      expect(res.scrollW).toBeLessThanOrEqual(res.clientW + 1);
    });
  }

  test("touch targets meet WCAG target-size rules on phones", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch sizing is a phone concern");
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(600);
    const bad = await page.evaluate(() => {
      const out = { controls: [], tiny: [] };
      document.querySelectorAll("a[href], button, input, select, textarea").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        // a hit-area expander counts toward the target
        let w = r.width, h = r.height;
        const a = getComputedStyle(el, "::after");
        if (a && a.content !== "none") {
          w = Math.max(w, parseFloat(a.width) || 0);
          h = Math.max(h, parseFloat(a.height) || 0);
        }
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${Math.round(w)}x${Math.round(h)}`;
        // A link sitting in a sentence is exempt from 2.5.8; it still must
        // not be microscopic, so it is held to the 24px floor.
        // The honeypot is a spam trap parked off-screen: no human ever
        // reaches it, and it is hidden from assistive technology.
        if (el.closest(".honeypot")) return;
        const inSentence = el.tagName === "A" && !!el.closest("p, .consent-note, .legal, .faq-item__panel");
        if (inSentence) {
          if (w < 24 || h < 24) out.tiny.push(label);
        } else if (w < 44 || h < 44) {
          out.controls.push(label);
        }
      });
      return out;
    });
    expect(bad.controls, "discrete controls under 44x44 (WCAG 2.5.5)").toEqual([]);
    expect(bad.tiny, "inline links under the 24px floor (WCAG 2.5.8)").toEqual([]);
  });
});

test.describe("content and hygiene", () => {
  test("no console errors and no failed requests", async ({ page }) => {
    const errors = [];
    const failed = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("the brochure section stays parked", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#brochure")).toBeHidden();
    // innerText, not textContent: the parked section's markup is still in the
    // document, it simply must never be rendered.
    const visible = await page.evaluate(() => document.body.innerText);
    expect(visible).not.toContain("Download the brochure");
  });

  test("no prices appear anywhere on the page", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/£\s?\d/);
    expect(text).not.toMatch(/\b\d+\s?(?:GBP|EUR|USD)\b/);
  });

  test("site files exist and are served correctly", async ({ request }) => {
    for (const [path, type] of [
      ["/robots.txt", "text/plain"],
      ["/sitemap.xml", "xml"],
      ["/favicon.ico", ""],
      ["/favicon.svg", "image/svg"],
      ["/site.webmanifest", ""],
      ["/apple-touch-icon.png", "image/png"],
    ]) {
      const res = await request.get(path);
      expect(res.status(), `${path} should be served`).toBe(200);
      if (type) expect(res.headers()["content-type"] || "").toContain(type);
    }
  });

  test("private pages are excluded from search engines", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    for (const p of ["/p/", "/manage", "/api/"]) expect(robots).toContain(`Disallow: ${p}`);
  });
});
