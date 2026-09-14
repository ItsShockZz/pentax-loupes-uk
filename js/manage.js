/**
 * manage.js — the passport manager (manage.html, served at /manage).
 * Issue passports, print QR cards, and work through check-ins, support
 * requests and colleague enquiries. Talks to /api/admin/* with the manager key.
 */
(function () {
  "use strict";

  const C = window.PassportCommon;
  const $ = (id) => document.getElementById(id);
  const KEY_STORAGE = "pp-manager-key";
  const FITTED_BY_STORAGE = "pp-fitted-by";
  const TABS = ["attention", "passports", "issue"];

  const state = {
    key: "",
    passports: [],
    activity: [],
    baseUrl: location.origin,
    editingId: null,
    lastIssued: null,
  };

  document.addEventListener("DOMContentLoaded", () => {
    C.boot();
    fillSelects();
    bindGate();
    bindTabs();
    bindToolbar();
    bindForm();
    bindResult();
    bindPrint();
    try {
      state.key = sessionStorage.getItem(KEY_STORAGE) || "";
    } catch {
      state.key = "";
    }
    if (state.key) load();
    else $("mg-key").focus();
  });

  /* -------------------------------------------------------------------- */
  /* Sign in                                                               */
  /* -------------------------------------------------------------------- */

  function bindGate() {
    const form = $("mg-gate-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = $("mg-key").value.trim();
      if (!key) {
        C.fieldError(form, "key", "Enter the manager key.");
        return;
      }
      C.fieldError(form, "key", "");
      state.key = key;
      C.setStatus($("mg-gate-status"), "Checking…");
      const ok = await load();
      if (ok) {
        try {
          sessionStorage.setItem(KEY_STORAGE, key);
        } catch {
          /* private mode: the key simply isn't remembered */
        }
      }
    });
    // Belt and braces for Enter in the key field (implicit submission is
    // standard, but some embedded browsers deliver Enter without a keypress).
    $("mg-key").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
    $("mg-signout").addEventListener("click", () => {
      state.key = "";
      try {
        sessionStorage.removeItem(KEY_STORAGE);
      } catch {
        /* ignore */
      }
      $("mg-app").hidden = true;
      $("mg-signout").hidden = true;
      $("mg-gate").hidden = false;
      $("mg-key").value = "";
      $("mg-key").focus();
    });
  }

  async function load() {
    const gateStatus = $("mg-gate-status");
    notice("");
    try {
      const [p, a] = await Promise.all([
        C.api("/api/admin/passports", { key: state.key }),
        C.api("/api/admin/activity", { key: state.key }),
      ]);
      state.passports = p.passports || [];
      state.activity = a.activity || [];
      state.baseUrl = p.baseUrl || location.origin;
      $("mg-banner").hidden = true;
      enter();
      render();
      return true;
    } catch (err) {
      if (err.status === 401) {
        C.setStatus(gateStatus, err.message, "error");
        state.key = "";
        try {
          sessionStorage.removeItem(KEY_STORAGE);
        } catch {
          /* ignore */
        }
        $("mg-app").hidden = true;
        $("mg-gate").hidden = false;
        return false;
      }
      const code = err.data && err.data.code;
      if (err.status === 503 && (code === "storage_unconfigured" || code === "admin_unconfigured")) {
        state.passports = [];
        state.activity = [];
        enter();
        showBanner(code, err.message);
        render();
        return true;
      }
      C.setStatus(gateStatus, err.message, "error");
      if (!$("mg-app").hidden) notice(err.message, "error");
      return false;
    }
  }

  function enter() {
    $("mg-gate").hidden = true;
    $("mg-app").hidden = false;
    $("mg-signout").hidden = false;
    C.setStatus($("mg-gate-status"), "");
  }

  function showBanner(code, message) {
    const banner = $("mg-banner");
    C.clear(banner);
    if (code === "storage_unconfigured") {
      banner.append(
        C.el("strong", { text: "Storage isn't connected yet" }),
        "Passports and requests can't be saved until a database is attached. In Vercel open this project, choose Storage, create an ",
        C.el("em", { text: "Upstash for Redis" }),
        " database and connect it to the project, then redeploy. The variables ",
        C.el("code", { text: "KV_REST_API_URL" }),
        " and ",
        C.el("code", { text: "KV_REST_API_TOKEN" }),
        " are added for you.",
      );
    } else {
      banner.append(C.el("strong", { text: "The manager key isn't set" }), message);
    }
    banner.hidden = false;
  }

  function notice(message, type) {
    C.setStatus($("mg-status"), message, type);
  }

  /* -------------------------------------------------------------------- */
  /* Tabs and toolbar                                                      */
  /* -------------------------------------------------------------------- */

  function bindTabs() {
    TABS.forEach((name) => $(`tab-${name}`).addEventListener("click", () => showTab(name)));
    $("mg-new").addEventListener("click", () => {
      if (state.editingId) resetForm();
      $("mg-result").hidden = true;
      showTab("issue");
      $("f-name").focus();
    });
    $("mg-refresh").addEventListener("click", async () => {
      const btn = $("mg-refresh");
      btn.disabled = true;
      await load();
      btn.disabled = false;
    });
  }

  function showTab(name) {
    TABS.forEach((n) => {
      $(`tab-${n}`).setAttribute("aria-selected", String(n === name));
      $(`panel-${n}`).hidden = n !== name;
    });
  }

  function bindToolbar() {
    $("mg-show-resolved").addEventListener("change", renderActivity);
    $("mg-search").addEventListener("input", renderPassports);
    $("mg-show-closed").addEventListener("change", renderPassports);
  }

  /* -------------------------------------------------------------------- */
  /* Rendering                                                             */
  /* -------------------------------------------------------------------- */

  function render() {
    renderStats();
    renderActivity();
    renderPassports();
  }

  const shortDate = (iso) => C.formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
  const openItems = () => state.activity.filter((a) => a.status === "open");
  const passportLink = (p) => `${state.baseUrl}/p/${p.token}`;

  function renderStats() {
    const open = openItems();
    const stats = [
      [open.filter((a) => a.kind === "support" || a.kind === "checkin").length, "Customers needing a hand"],
      [open.filter((a) => a.kind === "enquiry" || a.kind === "referral").length, "Enquiries to follow up"],
      [state.passports.filter((p) => p.active).length, "Active passports"],
      [state.activity.filter((a) => a.kind === "checkin" && a.topic === "All good").length, "Happy check-ins"],
    ];
    const wrap = $("mg-stats");
    C.clear(wrap);
    stats.forEach(([n, label]) => {
      wrap.appendChild(C.el("div", { class: "mg-stat" }, [C.el("strong", { text: String(n) }), C.el("span", { text: label })]));
    });
    const openCount = $("count-open");
    openCount.textContent = String(open.length);
    openCount.classList.toggle("mg-count--alert", open.length > 0);
    $("count-passports").textContent = String(state.passports.length);
  }

  function renderActivity() {
    const list = $("mg-activity");
    C.clear(list);
    const showResolved = $("mg-show-resolved").checked;
    const items = state.activity.filter((a) => showResolved || a.status === "open");
    if (!items.length) {
      list.appendChild(
        C.el("div", {
          class: "mg-empty",
          text: showResolved
            ? "Nothing here yet. Check-ins, support requests and colleague enquiries appear as customers use their passports."
            : "All clear. Nothing is waiting for you right now.",
        }),
      );
      return;
    }
    items.forEach((a) => list.appendChild(activityItem(a)));
  }

  function activityItem(a) {
    const kindLabel =
      { checkin: "Check-in", support: "Support", referral: "Colleague enquiry", enquiry: "Website enquiry" }[a.kind] || a.kind;
    const badgeClass = a.kind === "checkin" && a.topic === "All good" ? "mg-badge--good" : `mg-badge--${a.kind}`;
    const crmBadge =
      a.crm_status === "sent"
        ? C.el("span", { class: "mg-badge mg-badge--good", text: "Sent to CRM" })
        : a.crm_status === "failed"
          ? C.el("span", { class: "mg-badge mg-badge--off", text: "CRM failed" })
          : null;
    const head = C.el("div", { class: "mg-item__head" }, [
      C.el("span", { class: `mg-badge ${badgeClass}`, text: kindLabel }),
      a.status === "resolved" ? C.el("span", { class: "mg-badge", text: "Resolved" }) : null,
      crmBadge,
      C.el("span", { class: "mg-hint", text: C.timeAgo(a.created_at) }),
    ]);
    const title =
      a.kind === "referral" ? `${a.name} would like a demonstration` : a.kind === "enquiry" ? `${a.topic}: ${a.name}` : a.topic;
    const ref = a.passport_reference ? ` (${a.passport_reference})` : "";
    const meta = C.el("p", { class: "mg-item__meta" }, [
      a.kind === "referral"
        ? `Introduced by ${a.passport_name}${ref}`
        : a.kind === "enquiry"
          ? "Sent from the website form"
          : `${a.passport_name}${ref}`,
    ]);
    if (a.passport_token) {
      meta.append(" · ", C.el("a", { href: `/p/${a.passport_token}`, target: "_blank", rel: "noopener", text: "Open passport" }));
    }
    const body = C.el("div", {}, [head, C.el("h3", { text: title }), meta]);
    if (a.details && typeof a.details === "object") {
      const line = Object.entries(a.details)
        .filter(([, value]) => value !== "" && value != null)
        .map(([key, value]) => `${key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}: ${value}`)
        .join(" · ");
      if (line) body.appendChild(C.el("p", { class: "mg-item__details", text: line }));
    }
    if (a.message) body.appendChild(C.el("p", { class: "mg-item__msg", text: a.message }));

    const contact = C.el("p", { class: "mg-item__contact" });
    if (a.email) contact.appendChild(C.el("a", { href: `mailto:${a.email}`, text: a.email }));
    if (a.phone) contact.appendChild(C.el("a", { href: `tel:${a.phone.replace(/\s+/g, "")}`, text: a.phone }));
    if (a.practice) contact.appendChild(C.el("span", { text: a.practice }));
    if (a.postcode) contact.appendChild(C.el("span", { text: a.postcode }));
    if (a.profession) contact.appendChild(C.el("span", { text: a.profession }));
    if (contact.childNodes.length) body.appendChild(contact);

    const toggle = C.el("button", {
      class: "btn btn-ghost btn-sm",
      type: "button",
      text: a.status === "open" ? "Mark resolved" : "Reopen",
      onclick: async () => {
        toggle.disabled = true;
        try {
          const r = await C.api("/api/admin/activity", {
            method: "PATCH",
            key: state.key,
            body: { id: a.id, status: a.status === "open" ? "resolved" : "open" },
          });
          Object.assign(a, r.activity);
          render();
        } catch (err) {
          toggle.disabled = false;
          notice(err.message, "error");
        }
      },
    });
    const actions = C.el("div", { class: "mg-item__actions" }, [toggle]);
    if (a.email) {
      const subject =
        a.kind === "referral" || a.kind === "enquiry" ? "Your PENTAX Loupes enquiry" : `Your PENTAX Loupes: ${a.topic}`;
      actions.appendChild(
        C.el("a", { class: "btn btn-primary btn-sm", href: `mailto:${a.email}?subject=${encodeURIComponent(subject)}`, text: "Reply by email" }),
      );
    }
    return C.el("article", { class: `mg-item${a.status === "resolved" ? " mg-item--resolved" : ""}` }, [body, actions]);
  }

  function renderPassports() {
    const list = $("mg-passports");
    C.clear(list);
    const query = $("mg-search").value.trim().toLowerCase();
    const showClosed = $("mg-show-closed").checked;
    const items = state.passports.filter(
      (p) =>
        (showClosed || p.active) &&
        (!query || [p.name, p.reference, p.practice, p.email].some((v) => String(v || "").toLowerCase().includes(query))),
    );
    if (!items.length) {
      list.appendChild(
        C.el("div", {
          class: "mg-empty",
          text: state.passports.length ? "No passports match." : "No passports yet. Issue the first one from the “Issue a passport” tab.",
        }),
      );
      return;
    }
    items.forEach((p) => list.appendChild(passportItem(p)));
  }

  function passportItem(p) {
    const open = state.activity.filter((a) => a.passport_id === p.id && a.status === "open").length;
    const head = C.el("div", { class: "mg-item__head" }, [
      C.el("span", { class: `mg-badge${p.active ? "" : " mg-badge--off"}`, text: p.active ? "Active" : "Closed" }),
      open ? C.el("span", { class: "mg-badge mg-badge--support", text: `${open} open` }) : null,
      C.el("span", { class: "mg-hint", text: `Issued ${shortDate(p.created_at)}` }),
    ]);
    const meta = C.el("p", {
      class: "mg-item__meta",
      text: `${p.reference} · ${C.specSummary(p)}${p.practice ? ` · ${p.practice}` : ""}`,
    });
    const contact = C.el("p", { class: "mg-item__contact" }, [
      C.el("a", { href: `mailto:${p.email}`, text: p.email }),
      p.phone ? C.el("span", { text: p.phone }) : null,
      p.fitted_at ? C.el("span", { text: `Fitted ${shortDate(p.fitted_at)}` }) : null,
    ]);
    const body = C.el("div", {}, [head, C.el("h3", { text: p.name }), meta, contact]);
    if (p.notes) body.appendChild(C.el("p", { class: "mg-item__msg", text: p.notes }));

    const link = passportLink(p);
    const copyBtn = C.el("button", {
      class: "btn btn-ghost btn-sm",
      type: "button",
      text: "Copy link",
      onclick: async () => {
        const ok = await C.copyText(link);
        copyBtn.textContent = ok ? "Copied" : "Copy didn't work";
        window.setTimeout(() => (copyBtn.textContent = "Copy link"), 1600);
      },
    });
    const closeBtn = C.el("button", {
      class: `btn btn-ghost btn-sm${p.active ? " btn-danger" : ""}`,
      type: "button",
      text: p.active ? "Close passport" : "Reopen",
      onclick: async () => {
        if (p.active && !window.confirm(`Close ${p.name}'s passport? Their link and invitation link stop working until you reopen it.`)) return;
        closeBtn.disabled = true;
        try {
          const r = await C.api("/api/admin/passports", { method: "PATCH", key: state.key, body: { id: p.id, active: p.active ? 0 : 1 } });
          Object.assign(p, r.passport);
          render();
        } catch (err) {
          closeBtn.disabled = false;
          notice(err.message, "error");
        }
      },
    });
    const actions = C.el("div", { class: "mg-item__actions" }, [
      C.el("a", { class: "btn btn-primary btn-sm", href: link, target: "_blank", rel: "noopener", text: "Open" }),
      copyBtn,
      C.el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Print card", onclick: () => openPrint(p) }),
      C.el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Edit", onclick: () => startEdit(p) }),
      closeBtn,
    ]);
    return C.el("article", { class: `mg-item${p.active ? "" : " mg-item--off"}` }, [body, actions]);
  }

  /* -------------------------------------------------------------------- */
  /* Issue / edit form                                                     */
  /* -------------------------------------------------------------------- */

  function fillSelects() {
    const map = {
      discipline: "f-discipline",
      magnification: "f-magnification",
      colour: "f-colour",
      light: "f-light",
      lenses: "f-lenses",
      prescription: "f-prescription",
    };
    Object.entries(map).forEach(([key, id]) => {
      const select = $(id);
      C.clear(select);
      select.appendChild(C.el("option", { value: "", text: "Select…" }));
      C.OPTIONS[key].forEach((value) => {
        select.appendChild(C.el("option", { value, text: key === "magnification" ? `${value}×` : value }));
      });
    });
    try {
      $("f-fitted_by").value = localStorage.getItem(FITTED_BY_STORAGE) || "";
    } catch {
      /* ignore */
    }
  }

  const choose = (label) => (v) => Boolean(v) || `Please choose ${label}.`;
  const whole = (min, max) => (v) =>
    !v.trim() ||
    (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max) ||
    `Enter a whole number between ${min} and ${max}, or leave it blank.`;

  const FIELD_NAMES = [
    "name", "email", "phone", "practice", "discipline", "magnification", "colour", "light", "lenses",
    "prescription", "working_distance", "pupillary_distance", "fitted_at", "fitted_by", "reference", "notes",
  ];

  function collect(form) {
    const out = {};
    FIELD_NAMES.forEach((name) => {
      out[name] = form.elements[name] ? form.elements[name].value.trim() : "";
    });
    return out;
  }

  function bindForm() {
    const form = $("mg-form");
    const status = $("mg-form-status");
    const submit = $("mg-submit");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ok = C.validate(form, {
        name: C.RULES.name,
        email: C.RULES.email,
        phone: C.RULES.phoneOptional,
        discipline: choose("a discipline"),
        magnification: choose("a magnification"),
        colour: choose("a frame colour"),
        light: choose("a light option"),
        lenses: choose("whether protective lenses are fitted"),
        prescription: choose("a prescription option"),
        working_distance: whole(25, 70),
        pupillary_distance: whole(52, 78),
      });
      if (!ok) {
        C.setStatus(status, "Please check the highlighted fields.", "error");
        return;
      }
      const fields = collect(form);
      submit.disabled = true;
      submit.textContent = "Saving…";
      C.setStatus(status, "");
      try {
        let passport;
        const wasEdit = Boolean(state.editingId);
        if (wasEdit) {
          const r = await C.api("/api/admin/passports", { method: "PATCH", key: state.key, body: { id: state.editingId, fields } });
          passport = r.passport;
          const i = state.passports.findIndex((p) => p.id === passport.id);
          if (i >= 0) state.passports[i] = passport;
        } else {
          const r = await C.api("/api/admin/passports", { method: "POST", key: state.key, body: fields });
          passport = r.passport;
          state.passports.unshift(passport);
        }
        try {
          localStorage.setItem(FITTED_BY_STORAGE, fields.fitted_by);
        } catch {
          /* ignore */
        }
        resetForm();
        render();
        showResult(passport, wasEdit);
      } catch (err) {
        C.setStatus(status, err.message, "error");
        if (err.data && err.data.field) C.fieldError(form, err.data.field, err.message);
      } finally {
        submit.disabled = false;
        submit.textContent = state.editingId ? "Save changes" : "Issue passport";
      }
    });

    $("mg-cancel-edit").addEventListener("click", () => {
      resetForm();
      showTab("passports");
    });
  }

  function resetForm() {
    const form = $("mg-form");
    form.reset();
    state.editingId = null;
    $("mg-submit").textContent = "Issue passport";
    $("mg-cancel-edit").hidden = true;
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
    form.querySelectorAll(".field-error").forEach((node) => (node.textContent = ""));
    C.setStatus($("mg-form-status"), "");
    try {
      $("f-fitted_by").value = localStorage.getItem(FITTED_BY_STORAGE) || "";
    } catch {
      /* ignore */
    }
  }

  function startEdit(p) {
    const form = $("mg-form");
    resetForm();
    state.editingId = p.id;
    FIELD_NAMES.forEach((name) => {
      if (form.elements[name]) form.elements[name].value = p[name] == null ? "" : String(p[name]);
    });
    $("mg-submit").textContent = "Save changes";
    $("mg-cancel-edit").hidden = false;
    $("mg-result").hidden = true;
    showTab("issue");
    C.scrollTo($("mg-form"));
  }

  /* -------------------------------------------------------------------- */
  /* Result panel + printable card                                         */
  /* -------------------------------------------------------------------- */

  function showResult(p, wasEdit) {
    state.lastIssued = p;
    const link = passportLink(p);
    $("mg-result-eyebrow").textContent = wasEdit ? "Passport updated" : "Passport issued";
    $("mg-result-title").textContent = p.name;
    $("mg-result-sub").textContent = `${p.reference} · ${C.specSummary(p)}`;
    $("mg-result-link").value = link;
    $("mg-result-open").href = link;
    C.qrInto($("mg-result-qr"), link, { margin: 2 });
    $("mg-result").hidden = false;
    showTab("issue");
    C.scrollTo($("mg-result"));
  }

  function bindResult() {
    const copyBtn = $("mg-result-copy");
    copyBtn.addEventListener("click", async () => {
      const ok = await C.copyText($("mg-result-link").value);
      copyBtn.textContent = ok ? "Copied" : "Copy didn't work";
      window.setTimeout(() => (copyBtn.textContent = "Copy link"), 1600);
    });
    $("mg-result-print").addEventListener("click", () => state.lastIssued && openPrint(state.lastIssued));
    $("mg-result-another").addEventListener("click", () => {
      $("mg-result").hidden = true;
      resetForm();
      $("f-name").focus();
    });
  }

  function openPrint(p) {
    const link = passportLink(p);
    $("card-name").textContent = p.name;
    $("card-spec").textContent = C.specSummary(p) + (p.fitted_at ? ` · Fitted ${shortDate(p.fitted_at)}` : "");
    $("card-ref").textContent = p.reference;
    $("card-url").textContent = link.replace(/^https?:\/\//, "");
    C.qrInto($("card-qr"), link, { margin: 1, ecc: "Q" });
    $("mg-print").hidden = false;
    document.body.classList.add("no-scroll");
    $("mg-print-go").focus();
  }

  function closePrint() {
    $("mg-print").hidden = true;
    document.body.classList.remove("no-scroll");
  }

  function bindPrint() {
    $("mg-print-go").addEventListener("click", () => window.print());
    $("mg-print-close").addEventListener("click", closePrint);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("mg-print").hidden) closePrint();
    });
  }
})();
