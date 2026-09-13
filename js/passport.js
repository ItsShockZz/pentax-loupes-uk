/**
 * passport.js — the customer's loupe passport (passport.html, served at /p/<token>).
 * Loads the passport from /api/passport/<token>, renders it with DOM APIs
 * (no innerHTML), and handles the check-in, support form and invitation link.
 */
(function () {
  "use strict";

  const C = window.PassportCommon;
  const $ = (id) => document.getElementById(id);
  const token = C.tokenFromPath("p");
  const endpoint = `/api/passport/${encodeURIComponent(token)}`;
  let passport = null;

  document.addEventListener("DOMContentLoaded", () => {
    C.boot();
    fillTopics();
    bindTopicLinks();
    load();
  });

  function fillTopics() {
    const select = $("sp-topic");
    C.clear(select);
    select.appendChild(C.el("option", { value: "", text: "Choose a topic…" }));
    C.SUPPORT_TOPICS.forEach((topic) => select.appendChild(C.el("option", { value: topic, text: topic })));
  }

  function bindTopicLinks() {
    document.querySelectorAll("[data-topic]").forEach((link) => {
      link.addEventListener("click", () => {
        $("sp-topic").value = link.dataset.topic;
      });
    });
  }

  async function load() {
    if (!token) return showError();
    try {
      const data = await C.api(endpoint);
      passport = data.passport;
      render();
    } catch (err) {
      showError(err.status === 503 ? err.message : null);
    }
  }

  function showError(message) {
    $("pp-loading").hidden = true;
    $("pp-content").hidden = true;
    if (message) $("pp-error-message").textContent = message;
    $("pp-error").hidden = false;
  }

  /* -------------------------------------------------------------------- */
  /* Rendering                                                             */
  /* -------------------------------------------------------------------- */

  function render() {
    const p = passport;
    document.title = `${p.name} · Loupe passport | PENTAX Loupes UK`;
    C.fill(document, "reference", p.reference);
    C.fill(document, "greeting", C.greetingName(p.name));

    // Hero: the customer's own colour, plus a strip of what defines the pair.
    const img = $("pp-hero-img");
    img.src = C.colourImage(p.colour);
    img.alt = `PENTAX Loupes in ${p.colour}`;
    if (p.example) {
      const badge = $("pp-badge");
      badge.textContent = "Example passport";
      badge.classList.add("pp-hero__badge--example");
    }
    const chips = $("pp-chips");
    C.clear(chips);
    [
      [C.magLabel(p.magnification), true],
      [p.colour],
      [p.light !== "No light" ? p.light : null],
      [p.lenses === "Yes" ? "Protective lenses" : null],
    ].forEach(([text, blue]) => {
      if (text) chips.appendChild(C.el("span", { class: `pp-chip${blue ? " pp-chip--blue" : ""}`, text }));
    });

    const fitline = $("pp-fitline");
    C.clear(fitline);
    const parts = [];
    if (p.fitted_at) parts.push(["Fitted ", C.formatDate(p.fitted_at)]);
    if (p.fitted_by) parts.push(["by ", p.fitted_by]);
    if (p.practice) parts.push(["", p.practice]);
    parts.forEach((part, i) => {
      if (i) fitline.appendChild(C.el("span", { class: "pp-dot", "aria-hidden": "true" }));
      fitline.appendChild(C.el("span", {}, [part[0], C.el("strong", { text: part[1] })]));
    });
    fitline.hidden = !parts.length;

    renderSpecs(p);

    setTag("pp-tag-pd", p.pupillary_distance ? `Yours: ${p.pupillary_distance} mm` : "Adjustable 52–78 mm", Boolean(p.pupillary_distance));
    setTag("pp-tag-wd", p.working_distance ? `Yours: ${p.working_distance} cm` : "Adjustable 25–70 cm", Boolean(p.working_distance));
    setTag("pp-tag-lens", p.lenses === "Yes" ? "Yours: protective lenses fitted" : "Optional", p.lenses === "Yes");

    document.querySelectorAll("[data-acc]").forEach((card) => {
      const tag = card.querySelector("[data-acc-tag]");
      const key = card.dataset.acc;
      const owned = key === p.light || (key === "lenses" && (p.lenses === "Yes" || p.prescription !== "None"));
      if (tag && owned) {
        tag.textContent = "Part of your setup";
        tag.classList.add("pp-tag--on");
      }
    });

    renderInvite(p);
    bindCheckin();
    bindSupport();

    $("pp-loading").hidden = true;
    $("pp-content").hidden = false;
    C.enter();
    C.initReveals();
  }

  function setTag(id, text, on) {
    const tag = $(id);
    if (!tag) return;
    tag.textContent = text;
    tag.classList.toggle("pp-tag--on", on);
  }

  function renderSpecs(p) {
    const specs = $("pp-specs");
    C.clear(specs);
    const fieldOfView = C.fov(p.magnification);
    const shortDate = (iso) => C.formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
    const items = [
      { label: "Magnification", value: C.magLabel(p.magnification), note: fieldOfView ? `${fieldOfView} mm field of view` : "Fixed at manufacture" },
      { label: "Working distance", value: p.working_distance ? `${p.working_distance} cm` : null, empty: "Not recorded", note: "Adjustable 25–70 cm" },
      { label: "Pupillary distance", value: p.pupillary_distance ? `${p.pupillary_distance} mm` : null, empty: "Not recorded", note: "Adjustable 52–78 mm" },
      { label: "Frame colour", value: p.colour, swatch: C.colourHex(p.colour), note: "Four colours, one frame" },
      { label: "Illumination", value: p.light, soft: true, note: p.light === "No light" ? "An LED headlight can be added" : "Clips to the frame" },
      { label: "Protective lenses", value: p.lenses === "Yes" ? "Fitted" : "None", soft: true, note: p.lenses === "Yes" ? "Shield your eyes and the optics" : "Can be added later" },
      { label: "Prescription", value: p.prescription, soft: true, note: p.prescription === "None" ? "No correction needed" : "Carries your correction" },
      { label: "Discipline", value: p.discipline, soft: true, note: p.fitted_at ? `Fitted ${shortDate(p.fitted_at)}` : "" },
    ];
    items.forEach((item) => {
      const classes = ["pp-spec__value"];
      if (item.soft) classes.push("pp-spec__value--soft");
      if (!item.value) classes.push("pp-spec__value--empty");
      const value = C.el("div", { class: classes.join(" ") });
      if (item.swatch) value.appendChild(C.el("span", { class: "pp-swatch", style: `background:${item.swatch}`, "aria-hidden": "true" }));
      value.appendChild(document.createTextNode(item.value || item.empty || "—"));
      specs.appendChild(
        C.el("div", { class: "pp-spec" }, [
          C.el("span", { class: "pp-spec__label", text: item.label }),
          value,
          item.note ? C.el("span", { class: "pp-spec__note", text: item.note }) : null,
        ]),
      );
    });
  }

  /* -------------------------------------------------------------------- */
  /* Invitation link                                                       */
  /* -------------------------------------------------------------------- */

  function renderInvite(p) {
    const link = `${location.origin}/invite/${p.referral_token}`;
    $("pp-invite-link").value = link;
    C.qrInto($("pp-invite-qr"), link, { margin: 2 });

    const subject = "An invitation to see PENTAX Loupes";
    const body =
      "Hi,\n\nI've been wearing PENTAX Loupes and thought you might like to see them for yourself. " +
      `This link lets you request your own demonstration and fitting in the UK:\n\n${link}\n\n${p.name}`;
    $("pp-mail").href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (navigator.share) {
      const shareBtn = $("pp-share");
      shareBtn.hidden = false;
      shareBtn.addEventListener("click", () => {
        navigator.share({ title: subject, text: "See PENTAX Loupes for yourself", url: link }).catch(() => {});
      });
    }

    const copyBtn = $("pp-copy");
    copyBtn.addEventListener("click", async () => {
      const ok = await C.copyText(link);
      copyBtn.textContent = ok ? "Copied" : "Copy didn't work";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy link";
      }, 1800);
    });
  }

  /* -------------------------------------------------------------------- */
  /* Check-in                                                              */
  /* -------------------------------------------------------------------- */

  function bindCheckin() {
    const status = $("pp-checkin-status");
    const buttons = Array.from($("pp-checkin-actions").querySelectorAll("button"));
    const run = async (feeling) => {
      buttons.forEach((b) => (b.disabled = true));
      C.setStatus(status, "Sending…");
      try {
        await C.api(endpoint, { method: "POST", body: { kind: "checkin", feeling, website: "", requestKey: C.requestKey() } });
        C.setStatus(status, "");
        showCheckinDone(feeling);
      } catch (err) {
        buttons.forEach((b) => (b.disabled = false));
        C.setStatus(status, err.message, "error");
      }
    };
    $("pp-good").addEventListener("click", () => run("good"));
    $("pp-help").addEventListener("click", () => run("help"));
  }

  function showCheckinDone(feeling) {
    $("pp-checkin-ask").hidden = true;
    $("pp-checkin-actions").hidden = true;
    const done = $("pp-checkin-done");
    C.clear(done);
    if (feeling === "good") {
      done.append(
        C.el("span", { class: "pp-check", "aria-hidden": "true" }),
        C.el("h3", { text: "Brilliant. Thanks for letting us know." }),
        C.el("p", { text: "Enjoy the view. If a colleague has been eyeing up your loupes, your invitation link is just below." }),
        C.el("a", { class: "btn btn-ghost", href: "#invite", text: "Invite a colleague" }),
      );
    } else {
      done.append(
        C.el("span", { class: "pp-check pp-check--blue", "aria-hidden": "true" }),
        C.el("h3", { text: "Noted. Let's sort it." }),
        C.el("p", { text: "Tell us what's not quite right in the support form and the UK team will come back to you." }),
        C.el("a", { class: "btn btn-primary", href: "#support", text: "Tell us what's happening" }),
      );
      const topic = $("sp-topic");
      if (!topic.value) topic.value = "Fitting or adjustment";
      window.setTimeout(() => C.scrollTo($("support")), 500);
    }
    if (passport.example) done.appendChild(C.el("p", { class: "pp-share__hint", text: "This is the example passport, so nothing was saved." }));
    done.hidden = false;
  }

  /* -------------------------------------------------------------------- */
  /* Support form                                                          */
  /* -------------------------------------------------------------------- */

  function bindSupport() {
    const form = $("pp-support-form");
    const status = $("pp-support-status");
    const submit = form.querySelector("[type='submit']");
    const submitLabel = submit.textContent;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ok = C.validate(form, {
        topic: (v) => Boolean(v) || "Please choose a topic.",
        message: C.RULES.minLength(5, "tell us a little more"),
        email: C.RULES.email,
        phone: C.RULES.phoneOptional,
      });
      if (!ok) {
        C.setStatus(status, "Please check the highlighted fields.", "error");
        return;
      }
      const f = form.elements;
      const body = {
        kind: "support",
        topic: f.topic.value,
        message: f.message.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        website: f.website.value,
        requestKey: C.requestKey(),
      };
      submit.disabled = true;
      submit.textContent = "Sending…";
      C.setStatus(status, "");
      try {
        await C.api(endpoint, { method: "POST", body });
        form.hidden = true;
        if (passport.example) {
          $("pp-support-done-msg").textContent =
            "This is the example passport, so nothing was saved. On a real passport the UK team would come back to you by email.";
        }
        $("pp-support-done").hidden = false;
      } catch (err) {
        submit.disabled = false;
        submit.textContent = submitLabel;
        if (err.status === 503) showMailFallback(status, body);
        else C.setStatus(status, err.message, "error");
      }
    });

    $("pp-support-again").addEventListener("click", () => {
      form.reset();
      form.hidden = false;
      $("pp-support-done").hidden = true;
      submit.disabled = false;
      submit.textContent = submitLabel;
      C.setStatus(status, "");
      form.elements.message.focus();
    });
  }

  /** Storage down? Hand the message to their email client instead of losing it. */
  function showMailFallback(status, body) {
    C.clear(status);
    status.className = "form-status form-status--error";
    const subject = `${body.topic} · ${passport.reference}`;
    const text =
      `Passport: ${passport.reference} (${passport.name})\nTopic: ${body.topic}\n\n${body.message}\n\n` +
      `Reply to: ${body.email}${body.phone ? ` / ${body.phone}` : ""}`;
    status.append(
      "We couldn't send this just now. ",
      C.el("a", {
        class: "text-link",
        href: `mailto:${C.contactEmail()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
        text: "Email it to the UK team instead →",
      }),
    );
  }
})();
