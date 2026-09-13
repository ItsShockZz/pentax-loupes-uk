/**
 * passport-common.js — helpers shared by passport.html, invite.html and
 * manage.html. A classic script like the rest of the site (the CSP allows
 * only same-origin script files, no inline scripts). Exposes
 * window.PassportCommon. Nothing here writes HTML strings into the page:
 * every node is built with DOM APIs and textContent (see SECURITY.md).
 */
(function () {
  "use strict";

  // Mirrors lib/passport/options.js — tests/options.test.mjs keeps them in sync.
  const OPTIONS = {
    discipline: ["Dentistry", "Surgery", "Veterinary", "Other"],
    magnification: ["2.5", "3.0", "3.5", "4.0", "5.0"],
    colour: ["Silvergold", "Blue", "Black", "Red"],
    light: ["No light", "Wired LED", "Wireless LED"],
    lenses: ["Yes", "No"],
    prescription: ["None", "Own glasses underneath", "Prescription insert"],
  };
  const FIELD_OF_VIEW = { "2.5": 141, "3.0": 120, "3.5": 106, "4.0": 98, "5.0": 80 };
  const SUPPORT_TOPICS = [
    "Fitting or adjustment",
    "Cleaning and care",
    "Headlight or accessory",
    "Prescription or lenses",
    "Update my details",
    "Something else",
  ];
  const LIMITS = { workingDistance: [25, 70], pupillaryDistance: [52, 78] };

  // Same swatch colours as the configurator on index.html.
  const COLOUR_HEX = { silvergold: "#c9b48a", blue: "#2c5fe0", black: "#1d1d1f", red: "#a3231f" };

  /* -------------------------------------------------------------------- */
  /* Product helpers                                                       */
  /* -------------------------------------------------------------------- */

  function colourId(colour) {
    return String(colour || "").toLowerCase().replace(/[^a-z]/g, "");
  }
  function colourImage(colour) {
    const id = colourId(colour);
    return COLOUR_HEX[id] ? `/images/previews/colour-${id}.jpg` : "/images/product-hero.jpg";
  }
  function colourHex(colour) {
    return COLOUR_HEX[colourId(colour)] || "#555";
  }
  function magLabel(value) {
    return value ? `${value}×` : "";
  }
  function fov(value) {
    return FIELD_OF_VIEW[String(value)] || null;
  }
  function contactEmail() {
    return (window.siteConfig && window.siteConfig.contactEmail) || "info@pentaxloupes.com";
  }
  function specSummary(p) {
    return [magLabel(p.magnification), p.colour, p.light !== "No light" ? p.light : null, p.lenses === "Yes" ? "Protective lenses" : null]
      .filter(Boolean)
      .join(" · ");
  }

  /* -------------------------------------------------------------------- */
  /* Network                                                               */
  /* -------------------------------------------------------------------- */

  function requestKey() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.key) headers["x-passport-key"] = opts.key;
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin",
      });
    } catch {
      const err = new Error("We couldn't reach the server. Check your connection and try again.");
      err.status = 0;
      err.data = {};
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Something went wrong (${res.status}).`);
      err.status = res.status;
      err.data = data || {};
      throw err;
    }
    return data || {};
  }

  function tokenFromPath(prefix) {
    const match = location.pathname.match(new RegExp(`^/${prefix}/([^/]+)/?$`));
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    const params = new URLSearchParams(location.search);
    return params.get("t") || params.get("token") || "";
  }

  /* -------------------------------------------------------------------- */
  /* Formatting                                                            */
  /* -------------------------------------------------------------------- */

  function formatDate(iso, options) {
    if (!iso) return "";
    const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", options || { day: "numeric", month: "long", year: "numeric" }).format(date);
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const seconds = Math.max(0, (Date.now() - t) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    return formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
  }

  /** "Dr Alex Morgan" → "Dr Morgan", "Alex Morgan" → "Alex". */
  function greetingName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length >= 2 && /^(dr|mr|mrs|ms|miss|mx|prof|professor|sir|dame)\.?$/i.test(parts[0])) {
      return `${parts[0].replace(/\.$/, "")} ${parts[parts.length - 1]}`;
    }
    return parts[0];
  }

  /* -------------------------------------------------------------------- */
  /* DOM                                                                   */
  /* -------------------------------------------------------------------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : value);
      }
    }
    for (const child of children || []) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function fill(root, name, value) {
    root.querySelectorAll(`[data-fill="${name}"]`).forEach((node) => {
      node.textContent = value == null ? "" : String(value);
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function setStatus(node, message, type) {
    if (!node) return;
    node.textContent = message || "";
    node.className = `form-status${type ? ` form-status--${type}` : ""}`;
  }

  function fieldError(form, name, message) {
    const errorNode = form.querySelector(`[data-error-for="${name}"]`);
    const input = form.elements[name];
    if (errorNode) errorNode.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  const RULES = {
    name: (v) => v.trim().length > 1 || "Please enter your full name.",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Please enter a valid email address.",
    phoneOptional: (v) =>
      !v.trim() || Boolean(v.trim().replace(/[\s()-]/g, "").match(/^\+?\d{7,15}$/)) || "Please enter a valid phone number.",
    required: (label) => (v) => v.trim().length > 0 || `Please enter ${label}.`,
    minLength: (n, label) => (v) => v.trim().length >= n || `Please ${label}.`,
  };

  /** Runs rules against form fields; returns true when everything passes. */
  function validate(form, rules) {
    let ok = true;
    for (const [name, rule] of Object.entries(rules)) {
      const field = form.elements[name];
      if (!field) continue;
      const result = rule(field.value || "");
      fieldError(form, name, result === true ? "" : result);
      if (result !== true) ok = false;
    }
    if (!ok) {
      const first = form.querySelector("[aria-invalid='true']");
      if (first) first.focus();
    }
    return ok;
  }

  function qrInto(container, text, options) {
    if (!window.PentaxQR || !container) return null;
    clear(container);
    const qr = window.PentaxQR.encode(text, { ecc: (options && options.ecc) || "M" });
    container.appendChild(window.PentaxQR.toSvgElement(qr, options));
    return qr;
  }

  /* -------------------------------------------------------------------- */
  /* Page chrome: nav drawer, smooth anchors, scroll reveals               */
  /* -------------------------------------------------------------------- */

  function initNav() {
    const nav = document.querySelector(".nav");
    const toggle = document.querySelector(".nav__toggle");
    const drawer = document.querySelector(".nav__drawer");
    if (nav) nav.classList.add("nav--scrolled");
    const close = () => {
      if (!drawer || !toggle) return;
      drawer.classList.remove("nav__drawer--open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
    };
    if (toggle && drawer) {
      toggle.addEventListener("click", () => {
        const open = drawer.classList.toggle("nav__drawer--open");
        toggle.setAttribute("aria-expanded", String(open));
        document.body.classList.toggle("no-scroll", open);
      });
      drawer.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
    }
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute("href").slice(1);
      if (!id) {
        event.preventDefault();
        return;
      }
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      scrollTo(target);
    });
  }

  function scrollTo(target) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  /**
   * Plays the hero entrance (.pp-enter → .is-in). Skips the fade when the tab
   * is hidden or motion is reduced, so content never waits on an animation
   * that a background tab may not run.
   */
  function enter(root) {
    const nodes = (root || document).querySelectorAll(".pp-enter");
    const animate = document.visibilityState === "visible" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate) void document.body.offsetWidth; // flush styles so the transition can start from the hidden state
    nodes.forEach((node) => {
      if (!animate) node.style.transition = "none";
      node.classList.add("is-in");
    });
    // Safety net: a throttled or background tab may never advance the
    // transition clock, so snap to the final state once it should have ended.
    window.setTimeout(() => nodes.forEach((node) => (node.style.transition = "none")), 1000);
  }

  function initReveals(root) {
    const targets = (root || document).querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      targets.forEach((node) => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    targets.forEach((node) => observer.observe(node));
  }

  function boot() {
    document.documentElement.classList.remove("no-js");
    document.querySelectorAll("[data-contact-email]").forEach((node) => {
      node.textContent = contactEmail();
      if (node.tagName === "A") node.href = `mailto:${contactEmail()}`;
    });
    // Links that keep their own label but should open an email to the team.
    document.querySelectorAll("a[data-contact-href]").forEach((node) => {
      node.href = `mailto:${contactEmail()}`;
    });
    initNav();
  }

  // `window` in the browser; globalThis when tests import this file in Node.
  const root = typeof window !== "undefined" ? window : globalThis;
  root.PassportCommon = {
    OPTIONS,
    FIELD_OF_VIEW,
    SUPPORT_TOPICS,
    LIMITS,
    RULES,
    api,
    boot,
    clear,
    colourHex,
    colourId,
    colourImage,
    contactEmail,
    copyText,
    el,
    enter,
    fieldError,
    fill,
    formatDate,
    fov,
    greetingName,
    initReveals,
    magLabel,
    qrInto,
    requestKey,
    scrollTo,
    setStatus,
    specSummary,
    timeAgo,
    tokenFromPath,
    validate,
  };
})();
