/**
 * main.js — site-wide interactions outside the cinematic video tour:
 * navigation, FAQ accordion, testimonial carousel, magnification & colour
 * selectors, photo slots, stat count-ups, the build-your-loupes
 * configurator, form validation, and analytics hook stubs.
 *
 * Analytics is intentionally NOT wired to any provider — see `track()` below.
 */

/* ---------------------------------------------------------------------- */
/* Analytics hook (stub — attach a real provider later)                    */
/* ---------------------------------------------------------------------- */

function track(eventName, detail) {
  // Structured hook point per brief: quote_nav, request_demo_nav, request_demo_hero,
  // request_demo_final, magnification_select, colour_select,
  // specialist_contact, faq_open, configurator_quote, configurator_submit.
  // No analytics library is installed; this only logs in development.
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    console.debug("[analytics]", eventName, detail || "");
  }
  document.dispatchEvent(new CustomEvent("pentax:track", { detail: { eventName, ...detail } }));
}

/* ---------------------------------------------------------------------- */
/* Navigation                                                              */
/* ---------------------------------------------------------------------- */

function initNav() {
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav__toggle");
  const drawer = document.querySelector(".nav__drawer");
  if (!nav) return;

  const onScroll = () => nav.classList.toggle("nav--scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && drawer) {
    toggle.addEventListener("click", () => {
      const isOpen = drawer.classList.toggle("nav__drawer--open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("no-scroll", isOpen);
    });
    drawer.querySelectorAll("a").forEach((link) =>
      link.addEventListener("click", () => {
        drawer.classList.remove("nav__drawer--open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("no-scroll");
      })
    );
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href").slice(1);
      // Placeholder links (href="#", e.g. the privacy-policy stubs) must not
      // fall through to the browser default, which jumps to the top of the
      // page — worst mid-form.
      if (!id) {
        e.preventDefault();
        return;
      }
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });

  document.querySelectorAll("[data-track='quote_nav']").forEach((el) =>
    el.addEventListener("click", () => track("quote_nav"))
  );
  document.querySelectorAll("[data-track='request_demo_nav']").forEach((el) =>
    el.addEventListener("click", () => track("request_demo_nav"))
  );
}

/* ---------------------------------------------------------------------- */
/* FAQ accordion — markup is authored statically in index.html (readable   */
/* and fully present with no JS); this only adds the collapse/expand       */
/* behaviour and starts every panel closed.                                */
/* ---------------------------------------------------------------------- */

function bindFaq() {
  document.querySelectorAll(".faq-item__trigger").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      panel.hidden = isOpen;
      if (!isOpen) track("faq_open", { question: btn.textContent.trim() });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Testimonials — one at a time, portrait/quote, swipe + arrows            */
/* ---------------------------------------------------------------------- */

function initTestimonials() {
  const root = document.getElementById("testimonial-carousel");
  if (!root) return;

  let index = 0;
  const portrait = root.querySelector(".testimonial__portrait img");
  const quote = root.querySelector(".testimonial__quote");
  const name = root.querySelector(".testimonial__name");
  const role = root.querySelector(".testimonial__role");
  const prevBtn = root.querySelector(".testimonial__prev");
  const nextBtn = root.querySelector(".testimonial__next");
  const dotsWrap = root.querySelector(".testimonial__dots");

  testimonials.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "testimonial__dot";
    dot.setAttribute("aria-label", `Show testimonial ${i + 1} of ${testimonials.length}`);
    dot.addEventListener("click", () => render(i));
    dotsWrap.appendChild(dot);
  });

  function render(i) {
    index = (i + testimonials.length) % testimonials.length;
    const t = testimonials[index];
    portrait.src = t.image;
    portrait.alt = `Portrait of ${t.name}`;
    quote.textContent = `“${t.quote}”`;
    name.textContent = t.name;
    role.textContent = t.role;
    Array.from(dotsWrap.children).forEach((d, i2) => d.classList.toggle("is-active", i2 === index));
  }

  prevBtn.addEventListener("click", () => render(index - 1));
  nextBtn.addEventListener("click", () => render(index + 1));

  let touchStartX = null;
  root.addEventListener("touchstart", (e) => (touchStartX = e.changedTouches[0].clientX), { passive: true });
  root.addEventListener(
    "touchend",
    (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) render(index + (dx < 0 ? 1 : -1));
      touchStartX = null;
    },
    { passive: true }
  );

  render(0);
}

/* ---------------------------------------------------------------------- */
/* Photo slots — placeholders that swap themselves for real photos the     */
/* moment the referenced file exists. The <img> inside each slot starts    */
/* `hidden`; if its src actually loads, the slot flips to the photo. A     */
/* missing file (404) just leaves the styled placeholder in place, so the  */
/* client can drop images in under the documented filenames with no code   */
/* changes.                                                                */
/* ---------------------------------------------------------------------- */

function initPhotoSlots() {
  document.querySelectorAll("[data-photo-slot]").forEach((slot) => {
    const img = slot.querySelector("img");
    if (!img || !img.getAttribute("src")) return;
    // Never lazy-load these: a `hidden` image has no box, so lazy loading
    // would defer the fetch forever and the slot could never flip to its
    // photo even once the file exists.
    img.loading = "eager";
    const show = () => {
      img.hidden = false;
      slot.classList.add("has-photo");
    };
    if (img.complete && img.naturalWidth > 0) show();
    else img.addEventListener("load", show, { once: true });
  });
}

/* ---------------------------------------------------------------------- */
/* Magnification selector — shared by the tour chapter and the lower page. */
/* Updates the displayed number/FOV/guidance from real spec data           */
/* (js/config.js) and swaps the sample-view image in #magnification.       */
/* Sample files: images/mag-samples/mag-2-5.jpg … mag-5-0.jpg — until they */
/* exist, the styled placeholder shows the selected magnification.         */
/* ---------------------------------------------------------------------- */

/* Rack-zoom sample viewer: picking a magnification never jumps straight to
   that photo - it animates THROUGH the magnifications in between (2.5x to
   5.0x racks 3.0, 3.5 and 4.0 on the way), each step scaling the current
   photo into the next so the whole move reads as one continuous zoom pull.
   Each viewer ([data-mag-sample]) holds two stacked <img> layers that swap
   roles per step; the Web Animations API drives the per-step motion. */

const MAG_STEPS = [2.5, 3.0, 3.5, 4.0, 5.0];
let magShownValue = 2.5; // what the viewers currently display
let magAnimGen = 0; // bumped per request so an interrupted rack aborts

function magSampleSrc(value) {
  return `images/mag-samples/mag-${value.toFixed(1).replace(".", "-")}.jpg`;
}

/* Sample stills are deliberately static — no zoom, no crossfade, no rack
   animation (removed on client direction). Scrolling through the tour's
   magnification chapter switches the overlay still (one photo per level),
   and the buttons swap them instantly. */

function setMagStills(value) {
  const mag = magnifications.find((m) => m.value === value);
  if (!mag) return;
  const src = magSampleSrc(value);
  document.querySelectorAll(".mag-overlay__img, .mag-sample img[data-mag-layer]").forEach((img) => {
    if (img.getAttribute("src") !== src) img.src = src;
    if (!img.closest(".mag-overlay")) img.alt = `Sample view at ${mag.label} magnification`;
  });
}

function updateMagText(value) {
  const mag = magnifications.find((m) => m.value === value);
  if (!mag) return;
  document.querySelectorAll("[data-magnification-selector]").forEach((group) => {
    group.querySelectorAll("[data-magnification]").forEach((b) =>
      b.setAttribute("aria-pressed", String(parseFloat(b.dataset.magnification) === value))
    );
    const valueEl = group.querySelector("[data-mag-value]");
    const fovEl = group.querySelector("[data-mag-fov]");
    const guidanceEl = group.querySelector("[data-mag-guidance]");
    if (valueEl) valueEl.textContent = mag.label;
    if (fovEl) fovEl.textContent = `${mag.fov} mm field of view`;
    if (guidanceEl) guidanceEl.textContent = mag.guidance;
  });
}

function initMagScrollStills() {
  // Preload all five so scroll-switching never flashes a loading frame.
  MAG_STEPS.forEach((v) => {
    const im = new Image();
    im.src = magSampleSrc(v);
  });
  let lastValue = null;
  document.addEventListener("pentax:magscroll", (e) => {
    const local = Math.min(0.9999, Math.max(0, e.detail.local));
    const value = MAG_STEPS[Math.round(local * (MAG_STEPS.length - 1))];
    if (value === lastValue) return;
    lastValue = value;
    setMagStills(value);
    updateMagText(value);
  });
}

function applyMagnificationDisplay(value) {
  const mag = magnifications.find((m) => m.value === value);
  if (!mag) return;
  document.querySelectorAll("[data-magnification-selector]").forEach((group) => {
    const buttons = group.querySelectorAll("[data-magnification]");
    const valueEl = group.querySelector("[data-mag-value]");
    const fovEl = group.querySelector("[data-mag-fov]");
    const guidanceEl = group.querySelector("[data-mag-guidance]");
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(parseFloat(b.dataset.magnification) === value)));
    if (valueEl) valueEl.textContent = mag.label;
    if (fovEl) fovEl.textContent = `${mag.fov} mm field of view`;
    if (guidanceEl) guidanceEl.textContent = mag.guidance;
  });
  setMagStills(value);
}

function initMagnificationSelectors(tour) {
  document.querySelectorAll("[data-magnification]").forEach((btn) => {
    const inTour = Boolean(btn.closest("[data-chapter='magnification']"));
    btn.addEventListener("click", () => {
      const value = parseFloat(btn.dataset.magnification);
      if (!magnifications.some((m) => m.value === value)) return;
      // Capped below 1.0: a full-scale target lands exactly on the chapter
      // boundary and tips into the next scene (the 5.0x still shows from
      // local 0.875, so 0.95 sits safely inside its band).
      const levelLocal = Math.min(0.95, MAG_STEPS.indexOf(value) / (MAG_STEPS.length - 1));
      if (inTour && tour && tour.scrollToChapterLocal("magnification", levelLocal)) {
        // The smooth scroll steps the stills itself (see initMagScrollStills);
        // just reflect the choice in the copy immediately.
        updateMagText(value);
      } else {
        applyMagnificationDisplay(value);
      }
      track("magnification_select", { value });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Colour selector — every swatch now has a matching real shot in the      */
/* footage (verified frame by frame against the video): the tour's colour  */
/* chapter (34.0–41.0s) is a continuous colourway run, so pressing a       */
/* swatch scrolls the tour to that colour's own moment and the video       */
/* actually shows the frame just picked. The one-shot `is-pop` class       */
/* drives the click flare animation in main.css.                           */
/* ---------------------------------------------------------------------- */

const COLOUR_VIDEO_MOMENTS = { silvergold: 38.1, blue: 40.5, black: 39.2, red: 36.9 };

function initColourSelectors(tour) {
  const groups = document.querySelectorAll("[data-colour-selector]");
  groups.forEach((group) => {
    const buttons = group.querySelectorAll("[data-colour]");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.colour;
        const colour = colours.find((c) => c.id === id);
        if (!colour) return;
        buttons.forEach((b) => {
          const selected = b === btn;
          b.classList.toggle("is-selected", selected);
          b.setAttribute("aria-pressed", String(selected));
          b.classList.remove("is-pop");
        });
        // Pop flare on click — skipped under reduced motion (the CSS
        // disables the animation there, so animationend would never fire
        // and these once-listeners would pile up).
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          void btn.offsetWidth; // restart the animation even on repeated clicks
          btn.classList.add("is-pop");
          btn.addEventListener("animationend", () => btn.classList.remove("is-pop"), { once: true });
        }

        track("colour_select", { colour: colour.id });

        const moment = COLOUR_VIDEO_MOMENTS[id];
        if (tour && moment != null) tour.scrollToMoment("colour", moment);
      });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Scroll reveals — subtle, one-shot fade-up shared across sections.       */
/* ---------------------------------------------------------------------- */

function initScrollReveals() {
  const targets = document.querySelectorAll(".why-row, .trust__stat, .discipline-card, .steps__item");
  if (!targets.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ---------------------------------------------------------------------- */
/* Stat count-ups — numbers in the spec band count up from zero when the   */
/* band scrolls into view. Static under reduced motion (and without JS     */
/* the markup already contains the final numbers).                         */
/* ---------------------------------------------------------------------- */

function initCountUps() {
  const els = Array.from(document.querySelectorAll("[data-countup]"));
  const section = els.length && els[0].closest("section");
  if (!els.length || !section) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Scroll-DRIVEN, not time-driven: the numbers climb with your scroll as
  // the band comes up the screen and wind back down if you scroll away.
  // (The old version ran on a 1.1s timer that had already finished by the
  // time the band was fully in view, so it looked static.)
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const specs = els.map((el) => ({
    el,
    target: parseFloat(el.dataset.countup),
    decimals: parseInt(el.dataset.decimals || "0", 10),
    last: null,
  }));

  const render = () => {
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 when the band's top touches the bottom of the viewport, 1 once
    // it has risen ~55% of the way up.
    const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh * 0.55)));
    const eased = easeOut(p);
    specs.forEach((s) => {
      const text = (s.target * eased).toFixed(s.decimals);
      if (text !== s.last) {
        s.el.textContent = text;
        s.last = text;
      }
    });
  };
  // Bound directly to scroll (not rAF-queued): the work is four text
  // writes behind a change check, and a direct binding keeps counting
  // even when animation frames are throttled.
  window.addEventListener("scroll", render, { passive: true });
  window.addEventListener("resize", render, { passive: true });
  render();
}

/* ---------------------------------------------------------------------- */
/* Ambient clips — muted loops that only play while on screen. Static      */
/* poster under reduced motion.                                            */
/* ---------------------------------------------------------------------- */

function initAmbientVideos() {
  const vids = document.querySelectorAll("video[data-ambient]");
  if (!vids.length) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The zoom-in/zoom-out is baked into each file (forward + reversed
  // frames), so a native `loop` plays it seamlessly — an earlier version
  // reverse-seeked at 24fps in JS, and with several clips on screen at
  // once that decode storm visibly janked the whole page.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const v = entry.target;
        if (entry.isIntersecting && !reduced) v.play().catch(() => {});
        else v.pause();
      });
    },
    { threshold: 0.15 }
  );
  vids.forEach((v) => {
    v.loop = true;
    io.observe(v);
  });
}

/* ---------------------------------------------------------------------- */
/* Magnification range — mobile expandable rows (desktop uses <table>)     */
/* ---------------------------------------------------------------------- */

function initMagRows() {
  document.querySelectorAll(".mag-row__trigger").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    // Panels are authored open so the FOV data stays readable without JS
    // (the desktop table is display:none on mobile); collapse them here.
    if (panel) panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      if (panel) panel.hidden = isOpen;
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Shared field validators (used by both forms)                            */
/* ---------------------------------------------------------------------- */

const FIELD_RULES = {
  name: (v) => v.trim().length > 1 || "Please enter your full name.",
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Please enter a valid email address.",
  phone: (v) => (v.trim().replace(/[\s()-]/g, "").match(/^\+?\d{7,15}$/) && true) || "Please enter a valid phone number.",
};

/* ---------------------------------------------------------------------- */
/* Configurator — "build your loupes" flow ending in a quote request.      */
/*                                                                          */
/* No prices appear anywhere (contractual — quotes come from a specialist).*/
/* Consent is by clear statement at the point of submission (see the       */
/* consent-note under the submit button) rather than a checkbox: the       */
/* submission is the user's own enquiry, so contacting them about it       */
/* doesn't rely on marketing-consent checkboxes. Any future marketing      */
/* emails beyond the enquiry itself need their own opt-in.                 */
/*                                                                          */
/* NOTE: like the demo form, this is NOT wired to a backend/CRM yet — the  */
/* submit handler simulates success so UX can be reviewed end to end.      */
/* Replace the setTimeout with a real fetch/POST before launch, and re-run */
/* every validation server-side (see SECURITY.md).                         */
/* ---------------------------------------------------------------------- */

function initConfigurator() {
  const root = document.getElementById("cfg");
  if (!root) return null;

  const STEPS = ["colour", "magnification", "lenses", "light", "use"];
  const state = { colour: "", magnification: "", lenses: "", light: "", use: "" };

  const summaryEl = (key) => root.querySelector(`[data-cfg-summary="${key}"]`);
  const stepEl = (key) => root.querySelector(`[data-cfg-step="${key}"]`);
  const errorEl = (key) => root.querySelector(`[data-cfg-error="${key}"]`);

  // Per-step preview images. Values without a picture (Advise me, No
  // light, Not sure) hide the preview. Magnification reuses the real
  // sample-view photos; the rest are photo slots waiting on client images.
  const PREVIEWS = {
    colour: (v) => ({ src: `images/previews/colour-${v.toLowerCase()}.jpg`, label: v }),
    magnification: (v) =>
      /^\d/.test(v)
        ? { src: `images/mag-samples/mag-${v.replace("×", "").replace(".", "-")}.jpg`, label: `${v} sample view` }
        : null,
    lenses: (v) =>
      v === "Yes"
        ? { src: "images/previews/lenses-yes.jpg", label: "With protective lenses" }
        : v === "No"
          ? { src: "images/previews/lenses-no.jpg", label: "Without protective lenses" }
          : null,
    light: (v) =>
      v === "Wireless LED"
        ? { src: "images/led-wireless.jpg", label: "Wireless LED" }
        : v === "Wired LED"
          ? { src: "images/led-wired.jpg", label: "Wired LED" }
          : null,
  };

  function updateStepPreview(key, value) {
    const fig = root.querySelector(`[data-cfg-preview="${key}"]`);
    if (!fig) return;
    const spec = PREVIEWS[key] && value ? PREVIEWS[key](value) : null;
    if (!spec) {
      fig.hidden = true;
      return;
    }
    fig.hidden = false;
    const img = fig.querySelector("img");
    const label = fig.querySelector("[data-cfg-preview-label]");
    if (label) label.textContent = spec.label;
    fig.classList.remove("has-photo");
    img.hidden = true;
    img.onload = () => {
      img.hidden = false;
      fig.classList.add("has-photo");
    };
    img.onerror = () => {
      img.hidden = true;
      fig.classList.remove("has-photo");
    };
    img.src = spec.src;
    img.alt = spec.label;
    if (img.complete && img.naturalWidth > 0) {
      img.hidden = false;
      fig.classList.add("has-photo");
    }
  }

  function setValue(key, value) {
    state[key] = value;
    const dd = summaryEl(key);
    if (dd) dd.textContent = value || "—";
    const step = stepEl(key);
    if (step) step.classList.remove("cfg__step--invalid");
    const err = errorEl(key);
    if (err) err.hidden = true;
    updateStepPreview(key, value);
  }

  // Option buttons (colour cards + chips)
  root.querySelectorAll("[data-cfg-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.cfgOption;
      root.querySelectorAll(`[data-cfg-option="${key}"]`).forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn))
      );
      setValue(key, btn.dataset.value);
    });
  });

  // Use dropdown
  const useSelect = root.querySelector("[data-cfg-select='use']");
  if (useSelect) useSelect.addEventListener("change", () => setValue("use", useSelect.value));

  const contactStep = document.getElementById("cfg-contact");
  const quoteBtn = document.getElementById("cfg-quote-btn");
  const submitBtn = document.getElementById("cfg-submit");
  const statusEl = document.getElementById("cfg-status");

  function validateSteps() {
    let firstInvalid = null;
    STEPS.forEach((key) => {
      const ok = Boolean(state[key]);
      const step = stepEl(key);
      const err = errorEl(key);
      if (step) step.classList.toggle("cfg__step--invalid", !ok);
      if (err) err.hidden = ok;
      if (!ok && !firstInvalid) firstInvalid = step;
    });
    return firstInvalid;
  }

  if (quoteBtn) {
    quoteBtn.addEventListener("click", () => {
      const firstInvalid = validateSteps();
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      track("configurator_quote", { ...state });
      contactStep.hidden = false;
      contactStep.scrollIntoView({ behavior: "smooth", block: "center" });
      const nameInput = document.getElementById("cfgName");
      if (nameInput) window.setTimeout(() => nameInput.focus({ preventScroll: true }), 450);
    });
  }

  function showFieldError(id, message) {
    const err = root.querySelector(`[data-error-for="${id}"]`);
    const input = document.getElementById(id);
    if (err) err.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function validateContact() {
    const checks = [
      ["cfgName", FIELD_RULES.name],
      ["cfgEmail", FIELD_RULES.email],
      ["cfgPhone", FIELD_RULES.phone],
    ];
    let ok = true;
    checks.forEach(([id, rule]) => {
      const result = rule(document.getElementById(id).value);
      showFieldError(id, result === true ? "" : result);
      if (result !== true) ok = false;
    });
    return ok;
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      // A step can be un-answered after the contact reveal (the Use dropdown
      // can go back to "Select…") — surface that instead of failing silently.
      const invalidStep = validateSteps();
      if (invalidStep) {
        statusEl.textContent = "One of your choices above needs completing first.";
        statusEl.className = "form-status form-status--error";
        invalidStep.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (!validateContact()) {
        statusEl.textContent = "Please check the highlighted fields and try again.";
        statusEl.className = "form-status form-status--error";
        const firstBad = root.querySelector("[aria-invalid='true']");
        if (firstBad) firstBad.focus();
        return;
      }

      statusEl.textContent = "";
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";

      const name = document.getElementById("cfgName").value.trim();
      const firstName = name.split(/\s+/)[0] || "";

      // NOT WIRED TO A BACKEND YET — simulated so the flow can be reviewed.
      // Replace with a real request to the CRM endpoint before launch.
      window.setTimeout(() => {
        track("configurator_submit", { ...state });
        const success = document.getElementById("cfg-success");
        const msg = document.getElementById("cfg-success-msg");
        const recap = document.getElementById("cfg-success-recap");
        root.querySelector(".cfg__steps").hidden = true;
        root.querySelector(".cfg__summary").hidden = true;
        if (msg) {
          msg.textContent = `${firstName ? `Thanks, ${firstName}. ` : "Thanks. "}A PENTAX Loupes specialist will be in touch within 24 hours with your personalised quote.`;
        }
        if (recap) {
          recap.textContent = [state.colour, state.magnification, `Protective lenses: ${state.lenses}`, state.light, state.use].join("  ·  ");
        }
        success.hidden = false;
        success.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 700);
    });
  }

  return {
    setUse(value) {
      if (useSelect && Array.from(useSelect.options).some((o) => o.value === value || o.text === value)) {
        useSelect.value = value;
        setValue("use", value);
      }
    },
  };
}

/* Discipline cards pre-select the matching use in the configurator. */
function initDisciplineCards(configurator) {
  document.querySelectorAll("[data-configure-use]").forEach((card) => {
    card.addEventListener("click", () => {
      if (configurator) configurator.setUse(card.dataset.configureUse);
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Request-a-demonstration form — frontend validation only.                */
/* NOTE: not wired to any backend/CRM — see completion report.             */
/*                                                                          */
/* SECURITY: this validation exists for UX (catch obvious mistakes before  */
/* a round trip), not as a security boundary. Client-side validation is    */
/* always bypassable (devtools, curl, a modified request). The moment a    */
/* real backend exists, every one of these checks must be re-run           */
/* server-side before anything touches a database, CRM, or outbound email  */
/* — see SECURITY.md and TODO.md.                                          */
/*                                                                          */
/* Consent works the same way as the configurator: a clear statement under */
/* the submit button, not a checkbox — see the note in initConfigurator(). */
/* ---------------------------------------------------------------------- */

function initDemoForm() {
  const form = document.getElementById("demo-form");
  if (!form) return;

  const submitBtn = form.querySelector("[type='submit']");
  const statusEl = document.getElementById("demo-form-status");

  const validators = {
    fullName: FIELD_RULES.name,
    email: FIELD_RULES.email,
    phone: FIELD_RULES.phone,
    practice: (v) => v.trim().length > 1 || "Please enter your practice or company name.",
    profession: (v) => v.trim().length > 0 || "Please select your profession.",
    postcode: (v) => v.trim().length > 2 || "Please enter your postcode.",
  };

  function showFieldError(field, message) {
    const errorEl = form.querySelector(`[data-error-for="${field}"]`);
    const inputEl = form.elements[field];
    if (errorEl) errorEl.textContent = message || "";
    if (inputEl) inputEl.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function validateField(field) {
    const el = form.elements[field];
    if (!el || !validators[field]) return true;
    const result = validators[field](el.value);
    showFieldError(field, result === true ? "" : result);
    return result === true;
  }

  Object.keys(validators).forEach((field) => {
    const el = form.elements[field];
    if (el) el.addEventListener("blur", () => validateField(field));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const allValid = Object.keys(validators).every((field) => validateField(field));

    if (!allValid) {
      statusEl.textContent = "Please check the highlighted fields and try again.";
      statusEl.className = "form-status form-status--error";
      const firstInvalid = form.querySelector("[aria-invalid='true']");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    // No backend is wired up yet for this fresh build — this simulates a
    // submission so the UI/UX can be reviewed end-to-end. Replace with a
    // real request (fetch/POST) to the client's form/CRM endpoint.
    window.setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = "Request a fitting & demonstration";
      statusEl.textContent = "Thanks. A PENTAX Loupes specialist will be in touch shortly to arrange your demonstration.";
      statusEl.className = "form-status form-status--success";
      form.reset();
      track("request_demo_final", {});
    }, 700);
  });
}

/* ---------------------------------------------------------------------- */
/* Populate data-driven sections from config.js                           */
/* ---------------------------------------------------------------------- */

function populateContent() {
  document.querySelectorAll("[data-contact-email]").forEach((el) => {
    el.textContent = siteConfig.contactEmail;
    el.href = `mailto:${siteConfig.contactEmail}`;
  });

  const phoneEls = document.querySelectorAll("[data-contact-phone]");
  phoneEls.forEach((el) => {
    if (siteConfig.phone) {
      el.textContent = siteConfig.phone;
      el.href = `tel:${siteConfig.phone}`;
    } else {
      el.closest("[data-contact-phone-row]")?.setAttribute("hidden", "");
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Boot                                                                    */
/* ---------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.remove("no-js");
  populateContent();
  initNav();
  bindFaq();
  initTestimonials();
  initDemoForm();
  initScrollReveals();
  initCountUps();
  initMagRows();
  initPhotoSlots();
  initAmbientVideos();

  // Created before initColourSelectors() so its buttons can jump the tour
  // to a specific colour's real footage moment (see COLOUR_VIDEO_MOMENTS).
  let tour = null;
  const wrapperEl = document.getElementById("tour");
  if (wrapperEl) {
    tour = new PentaxProductTour.ProductTour({
      wrapperEl,
      railEl: document.getElementById("tour-rail"),
      videoEl: document.getElementById("tour-video"),
    });
    tour.start();
  }

  initColourSelectors(tour);
  initMagnificationSelectors(tour);
  initMagScrollStills();
  applyMagnificationDisplay(2.5); // sync displays + sample slot to the default

  const configurator = initConfigurator();
  initDisciplineCards(configurator);

  document.querySelectorAll("[data-track='specialist_contact']").forEach((el) =>
    el.addEventListener("click", () => track("specialist_contact"))
  );
  document.querySelectorAll("[data-track='request_demo_hero']").forEach((el) =>
    el.addEventListener("click", () => track("request_demo_hero"))
  );
});
