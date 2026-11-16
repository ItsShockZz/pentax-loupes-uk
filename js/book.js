/**
 * Book a discovery call (/book).
 *
 * Loads the free times and the form's wording from /api/book-slots, lets the
 * visitor pick a day and a time and fill in five fields, and posts the booking
 * to /api/book. Both are this site's own endpoints, which talk to the CRM
 * (lib/booking.js). The consent wording, the professions and the notice come
 * from the CRM, so the words shown here are the words it records.
 *
 * Every piece of text from the server goes in through textContent, never as
 * HTML.
 */
(function () {
  "use strict";

  var root = document.getElementById("booking");
  if (!root) return;
  document.documentElement.classList.remove("no-js");

  var FIELDS = ["first_name", "last_name", "email", "phone", "profession"];
  var LABELS = {
    first_name: "First name",
    last_name: "Last name",
    email: "Email",
    phone: "Phone or WhatsApp number",
    profession: "Profession",
  };
  var AUTOCOMPLETE = { first_name: "given-name", last_name: "family-name", email: "email", phone: "tel" };

  var state = {
    config: null,
    days: [],
    dayKey: "",
    slotId: "",
    values: { first_name: "", last_name: "", email: "", phone: "", profession: "" },
    whatsapp: false,
    honeypot: "",
    errors: {},
    formError: "",
    slotNotice: "",
    submitting: false,
    openedAt: 0,
  };

  var longDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
  var clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  function describe(startsAt) {
    var d = new Date(startsAt);
    return longDay.format(d).replace(",", "") + " at " + clock.format(d);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function contactLink() {
    var email = (state.config && state.config.contact_email) || "hello@smoothoptics.com";
    return el("a", { className: "bk-link", href: "mailto:" + email, text: email });
  }

  function privacyLink() {
    var url = (state.config && state.config.privacy_url) || "/privacy.html";
    return el("a", { className: "bk-link", href: url, text: "Privacy notice" });
  }

  function currentDay() {
    for (var i = 0; i < state.days.length; i++) if (state.days[i].key === state.dayKey) return state.days[i];
    return state.days[0] || null;
  }

  function selectedSlot() {
    for (var i = 0; i < state.days.length; i++) {
      for (var j = 0; j < state.days[i].slots.length; j++) {
        if (state.days[i].slots[j].id === state.slotId) return state.days[i].slots[j];
      }
    }
    return null;
  }

  /* ---- rendering ------------------------------------------------------ */

  function renderMessage(children) {
    root.replaceChildren(el("div", { className: "bk-card" }, [el("p", { className: "bk-body" }, children)]));
  }

  function renderTimes() {
    var card = el("section", { className: "bk-card", "aria-labelledby": "bk-time-title" }, [
      el("h2", { id: "bk-time-title", className: "bk-step" }, [el("span", { className: "bk-step__no", text: "1" }), "Choose a time"]),
    ]);

    if (state.days.length === 0) {
      card.appendChild(el("p", { className: "bk-body" }, [
        "There are no times open right now. New times are added every few days, so please check back, or email ",
        contactLink(), " and we'll find one.",
      ]));
      return card;
    }

    var day = currentDay();
    var days = el("div", { className: "bk-days" });
    state.days.forEach(function (d) {
      var count = d.slots.length + (d.slots.length === 1 ? " time" : " times");
      days.appendChild(el("label", { className: "bk-chip bk-day" }, [
        el("input", {
          type: "radio", name: "day", value: d.key, checked: day && day.key === d.key,
          onchange: function () { state.dayKey = d.key; render(); },
        }),
        el("span", { className: "bk-day__inner" }, [
          el("span", { className: "bk-day__label", text: d.label }),
          el("span", { className: "bk-day__count", text: count }),
        ]),
      ]));
    });
    card.appendChild(el("fieldset", { className: "bk-fieldset" }, [el("legend", { className: "bk-legend", text: "Day" }), days]));

    if (day) {
      var times = el("div", { className: "bk-times" });
      day.slots.forEach(function (s) {
        times.appendChild(el("label", { className: "bk-chip bk-time" }, [
          el("input", {
            type: "radio", name: "slot_id", value: s.id, checked: state.slotId === s.id,
            onchange: function () { pickSlot(s.id); },
          }),
          el("span", { className: "bk-time__inner", text: s.time }),
        ]));
      });
      card.appendChild(el("fieldset", { className: "bk-fieldset" }, [
        el("legend", { className: "bk-legend", text: "Time on " + day.label + " (UK time)" }),
        times,
      ]));
    }
    if (state.slotNotice) card.appendChild(el("p", { className: "bk-warn", role: "alert", text: state.slotNotice }));
    if (state.errors.slot_id) card.appendChild(el("p", { className: "bk-error", text: state.errors.slot_id }));
    return card;
  }

  function field(name) {
    var error = state.errors[name];
    var control;
    if (name === "profession") {
      control = el("select", {
        id: "bk-" + name, name: name, className: "bk-input", required: true,
        "aria-invalid": error ? "true" : null, "aria-describedby": error ? "bk-err-" + name : null,
        onchange: function (e) { state.values[name] = e.target.value; clearError(name); },
      }, [el("option", { value: "", disabled: true, selected: state.values.profession === "", text: "Choose one" })]
        .concat(((state.config && state.config.professions) || []).map(function (p) {
          return el("option", { value: p, selected: state.values.profession === p, text: p });
        })));
    } else {
      control = el("input", {
        id: "bk-" + name, name: name, className: "bk-input", required: true,
        type: name === "email" ? "email" : name === "phone" ? "tel" : "text",
        inputmode: name === "email" ? "email" : name === "phone" ? "tel" : null,
        autocomplete: AUTOCOMPLETE[name], value: state.values[name],
        "aria-invalid": error ? "true" : null, "aria-describedby": error ? "bk-err-" + name : null,
        oninput: function (e) { state.values[name] = e.target.value; clearError(name); },
      });
    }
    return el("div", { className: "bk-field" }, [
      el("label", { for: "bk-" + name, text: LABELS[name] }),
      control,
      error ? el("span", { id: "bk-err-" + name, className: "bk-error", text: error }) : null,
    ]);
  }

  function renderDetails() {
    var slot = selectedSlot();
    var consent = (state.config && state.config.consent) || { label: "", hint: "" };
    var form = el("form", { className: "bk-card", novalidate: true, "aria-labelledby": "bk-details-title", onsubmit: submit }, [
      el("h2", { id: "bk-details-title", className: "bk-step" }, [el("span", { className: "bk-step__no", text: "2" }), "Your details"]),
      el("p", { className: "bk-selected" }, slot
        ? ["Your call: ", el("strong", { text: describe(slot.starts_at) })]
        : ["Pick a time above."]),
      el("div", { className: "bk-grid" }, FIELDS.map(field)),
      el("label", { className: "bk-consent" }, [
        el("input", {
          type: "checkbox", name: "whatsapp_consent", checked: state.whatsapp,
          "aria-labelledby": "bk-consent-label", "aria-describedby": "bk-consent-hint",
          onchange: function (e) { state.whatsapp = e.target.checked; },
        }),
        el("span", null, [
          el("span", { id: "bk-consent-label", className: "bk-consent__label", text: consent.label }),
          el("span", { id: "bk-consent-hint", className: "bk-consent__hint" }, [consent.hint + " ", privacyLink()]),
        ]),
      ]),
      el("div", { className: "bk-honeypot", "aria-hidden": "true" }, [
        el("label", { for: "bk-website", text: "Leave this field empty" }),
        el("input", {
          id: "bk-website", name: "website", type: "text", tabindex: "-1", autocomplete: "off", value: state.honeypot,
          oninput: function (e) { state.honeypot = e.target.value; },
        }),
      ]),
      el("button", {
        type: "submit", className: "btn btn-primary bk-submit", disabled: state.submitting,
        "aria-busy": state.submitting ? "true" : null, "data-track": "book_call_submit",
        text: state.submitting ? "Booking…" : "Book my call",
      }),
      state.formError ? el("p", { className: "bk-error", role: "alert", text: state.formError }) : null,
      el("p", { className: "bk-note" }, [((state.config && state.config.notice) || "") + " ", privacyLink()]),
    ]);
    return form;
  }

  function render() {
    var focusedId = document.activeElement && document.activeElement.id;
    root.replaceChildren(renderTimes());
    if (state.days.length > 0) root.appendChild(renderDetails());
    if (focusedId) {
      var again = document.getElementById(focusedId);
      if (again) again.focus();
    }
  }

  function renderConfirmed(booking, email) {
    var title = el("h2", { className: "bk-done__title", tabindex: "-1", text: "You're booked" });
    root.replaceChildren(el("section", { className: "bk-card" }, [
      title,
      el("p", { className: "bk-done__when", text: describe(booking.starts_at) + ", UK time" }),
      el("p", { className: "bk-body" }, booking.call_booked
        ? ["We're emailing the Zoom link and a calendar invitation to ", el("strong", { text: email }),
           ", and we'll send you a reminder before the call."]
        : ["Your time is held. We'll email the Zoom link to ", el("strong", { text: email }), " shortly."]),
      el("p", { className: "bk-note" }, [
        "Need a different time? Reply to the confirmation email, or email ", contactLink(), ".",
      ]),
      el("a", { className: "btn btn-ghost bk-again", href: "/", text: "Back to the site" }),
    ]));
    title.focus();
    track("book_call_booked");
  }

  /* ---- behaviour ------------------------------------------------------ */

  function track(name) {
    document.dispatchEvent(new CustomEvent("pentax:track", { detail: { eventName: name } }));
  }

  function clearError(name) {
    if (state.errors[name]) {
      delete state.errors[name];
      var input = document.getElementById("bk-" + name);
      var message = document.getElementById("bk-err-" + name);
      if (input) input.removeAttribute("aria-invalid");
      if (message) message.remove();
    }
  }

  function pickSlot(id) {
    state.slotId = id;
    state.slotNotice = "";
    delete state.errors.slot_id;
    render();
    var heading = document.getElementById("bk-details-title");
    if (heading) {
      var smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }

  function submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    state.formError = "";

    var missing = {};
    if (!state.slotId) missing.slot_id = "Pick a time first.";
    FIELDS.forEach(function (f) { if (!String(state.values[f]).trim()) missing[f] = "Required"; });
    if (Object.keys(missing).length > 0) {
      state.errors = missing;
      state.formError = missing.slot_id || "Please fill in the highlighted fields.";
      render();
      return;
    }

    state.submitting = true;
    render();
    var payload = {
      slot_id: state.slotId,
      first_name: state.values.first_name,
      last_name: state.values.last_name,
      email: state.values.email,
      phone: state.values.phone,
      profession: state.values.profession,
      whatsapp_consent: state.whatsapp,
      website: state.honeypot,
      fill_ms: state.openedAt ? Date.now() - state.openedAt : undefined,
    };

    fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (answer) {
        var res = answer.res;
        var data = answer.data || {};
        state.submitting = false;
        if (res.ok && data.ok) {
          renderConfirmed(data.booking, state.values.email.trim());
          return;
        }
        if (res.status === 409 && Array.isArray(data.days)) {
          state.days = data.days;
          if (!state.days.some(function (d) { return d.key === state.dayKey; })) state.dayKey = state.days[0] ? state.days[0].key : "";
          state.slotId = "";
          state.slotNotice = data.error || "That time is no longer available. Please pick another.";
          if (data.code === "already_booked") state.formError = data.error;
          render();
          return;
        }
        if (data.fields && typeof data.fields === "object") state.errors = data.fields;
        state.formError = data.error || "Sorry, something went wrong. Please try again.";
        render();
      })
      .catch(function () {
        state.submitting = false;
        state.formError = "We couldn't reach the booking calendar. Check your connection and try again.";
        render();
      });
  }

  function load() {
    fetch("/api/book-slots", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (answer) {
        if (!answer.res.ok || !Array.isArray(answer.data.days)) {
          renderMessage([
            (answer.data && answer.data.error) || "The booking calendar couldn't be loaded just now.",
            " Please try again in a minute, or email ", contactLink(), ".",
          ]);
          return;
        }
        state.config = answer.data;
        state.days = answer.data.days;
        state.dayKey = state.days[0] ? state.days[0].key : "";
        state.openedAt = Date.now();
        root.setAttribute("data-state", "ready");
        render();
      })
      .catch(function () {
        renderMessage(["The booking calendar couldn't be loaded just now. Please try again in a minute, or email ", contactLink(), "."]);
      });
  }

  load();
})();
