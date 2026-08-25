/**
 * main.js — site-wide interactions outside the cinematic video tour:
 * navigation, FAQ accordion, testimonial carousel, magnification & colour
 * selectors (tour + lower page), form validation, and analytics hook stubs.
 *
 * Analytics is intentionally NOT wired to any provider — see `track()` below.
 */

/* ---------------------------------------------------------------------- */
/* Analytics hook (stub — attach a real provider later)                    */
/* ---------------------------------------------------------------------- */

function track(eventName, detail) {
  // Structured hook point per brief: request_demo_nav, request_demo_hero,
  // request_demo_final, magnification_select, colour_select,
  // specialist_contact, faq_open. No analytics library is installed; this
  // only logs in development.
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
      const target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });

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
/* Magnification selector — shared by the tour chapter and the lower page. */
/* Purely informational for now: it updates the displayed number/FOV/      */
/* guidance from real spec data (js/config.js), but doesn't scrub the tour */
/* video — the current footage doesn't have a matching zoom-through-the-   */
/* lens shot for each magnification level (see TODO.md). Wire that up      */
/* once that footage exists instead of faking it against unrelated b-roll. */
/* ---------------------------------------------------------------------- */

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
}

function initMagnificationSelectors() {
  document.querySelectorAll("[data-magnification]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = parseFloat(btn.dataset.magnification);
      if (!magnifications.some((m) => m.value === value)) return;
      applyMagnificationDisplay(value);
      track("magnification_select", { value });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Colour selector — the tour footage is filmed in specific real colours,  */
/* so this updates the selected label/state rather than trying to recolour */
/* video frames on the fly. Three of the four swatches DO have a matching  */
/* real shot in the footage (verified directly against the video, not      */
/* guessed) within the "colour" chapter's own scroll range — pressing one  */
/* of those additionally scrolls the tour to that exact moment, so the     */
/* video actually shows the colour just picked. "blue" has no matching     */
/* shot in this edit, so pressing it only updates the label, same as       */
/* before.                                                                 */
/* ---------------------------------------------------------------------- */

const COLOUR_VIDEO_MOMENTS = { black: 35.0, red: 36.75, silvergold: 38.0 };

function initColourSelectors(tour) {
  const groups = document.querySelectorAll("[data-colour-selector]");
  groups.forEach((group) => {
    const buttons = group.querySelectorAll("[data-colour]");
    // The label sits next to `.colour-swatches`, not inside it (a sibling,
    // for its own bigger/bolder styling) — search the shared parent, not
    // `group` itself.
    const labelEl = (group.parentElement || group).querySelector("[data-colour-label]");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.colour;
        const colour = colours.find((c) => c.id === id);
        if (!colour) return;
        buttons.forEach((b) => {
          const selected = b === btn;
          b.classList.toggle("is-selected", selected);
          b.setAttribute("aria-pressed", String(selected));
        });
        if (labelEl) labelEl.textContent = colour.label;
        track("colour_select", { colour: colour.id });

        const moment = COLOUR_VIDEO_MOMENTS[id];
        if (tour && moment != null) tour.scrollToMoment("colour", moment);
      });
    });
  });
}

/* ---------------------------------------------------------------------- */
/* Scroll reveals (Why PENTAX rows, bento cards, trust stats) — subtle,    */
/* one-shot fade-up shared across every section that wants it.             */
/* ---------------------------------------------------------------------- */

function initScrollReveals() {
  const targets = document.querySelectorAll(".why-row, .bento__card, .trust__stat");
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
/* Magnification range — mobile expandable rows (desktop uses <table>)     */
/* ---------------------------------------------------------------------- */

function initMagRows() {
  document.querySelectorAll(".mag-row__trigger").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      if (panel) panel.hidden = isOpen;
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
/* ---------------------------------------------------------------------- */

function initDemoForm() {
  const form = document.getElementById("demo-form");
  if (!form) return;

  const submitBtn = form.querySelector("[type='submit']");
  const statusEl = document.getElementById("demo-form-status");

  const validators = {
    fullName: (v) => v.trim().length > 1 || "Please enter your full name.",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Please enter a valid email address.",
    phone: (v) => (v.trim().replace(/[\s()-]/g, "").match(/^\+?\d{7,15}$/) && true) || "Please enter a valid phone number.",
    practice: (v) => v.trim().length > 1 || "Please enter your practice or company name.",
    profession: (v) => v.trim().length > 0 || "Please select your profession.",
    postcode: (v) => v.trim().length > 2 || "Please enter your postcode.",
    consent: (v, el) => el.checked || "Please confirm you're happy for us to contact you.",
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
    const value = el.type === "checkbox" ? el.checked : el.value;
    const result = validators[field](value, el);
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
      statusEl.textContent =
        "Thanks — this is a demo build, so nothing has been sent yet. A specialist would normally be in touch shortly.";
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
  initMagRows();

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
  initMagnificationSelectors();

  document.querySelectorAll("[data-track='specialist_contact']").forEach((el) =>
    el.addEventListener("click", () => track("specialist_contact"))
  );
  document.querySelectorAll("[data-track='request_demo_hero']").forEach((el) =>
    el.addEventListener("click", () => track("request_demo_hero"))
  );
});
