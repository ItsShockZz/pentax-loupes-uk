/**
 * invite.js — a colleague's invitation page (invite.html, served at /invite/<token>).
 * Shows who invited them and takes a demonstration request.
 */
(function () {
  "use strict";

  const C = window.PassportCommon;
  const $ = (id) => document.getElementById(id);
  const token = C.tokenFromPath("invite");
  const endpoint = `/api/invite/${encodeURIComponent(token)}`;
  let invitation = null;

  document.addEventListener("DOMContentLoaded", () => {
    C.boot();
    load();
  });

  async function load() {
    if (!token) return showError();
    try {
      const data = await C.api(endpoint);
      invitation = data.invitation;
      render();
    } catch (err) {
      showError(err.status === 503 ? err.message : null);
    }
  }

  function showError(message) {
    $("iv-loading").hidden = true;
    $("iv-content").hidden = true;
    if (message) $("iv-error-message").textContent = message;
    $("iv-error").hidden = false;
  }

  function initials(name) {
    const parts = String(name || "")
      .replace(/^(dr|mr|mrs|ms|miss|mx|prof|professor)\.?\s+/i, "")
      .trim()
      .split(/\s+/);
    return parts
      .slice(0, 2)
      .map((part) => (part[0] ? part[0].toUpperCase() : ""))
      .join("");
  }

  function render() {
    const name = invitation.name;
    const short = C.greetingName(name);
    C.fill(document, "inviter", short);
    C.fill(document, "inviter-full", name);
    $("iv-avatar").textContent = initials(name);
    document.title = `${short} invites you to see PENTAX Loupes | PENTAX Loupes UK`;
    bindForm();
    $("iv-loading").hidden = true;
    $("iv-content").hidden = false;
    C.enter();
    C.initReveals();
  }

  function bindForm() {
    const form = $("iv-form");
    const status = $("iv-status");
    const submit = form.querySelector("[type='submit']");
    const submitLabel = submit.textContent;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ok = C.validate(form, {
        name: C.RULES.name,
        email: C.RULES.email,
        phone: C.RULES.phoneOptional,
        practice: C.RULES.minLength(2, "enter your practice or company name"),
        postcode: C.RULES.minLength(3, "enter your postcode"),
      });
      if (!ok) {
        C.setStatus(status, "Please check the highlighted fields and try again.", "error");
        return;
      }
      const f = form.elements;
      const body = {
        name: f.name.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        practice: f.practice.value.trim(),
        postcode: f.postcode.value.trim(),
        profession: f.profession.value,
        message: f.message.value.trim(),
        website: f.website.value,
        requestKey: C.requestKey(),
      };
      submit.disabled = true;
      submit.textContent = "Sending…";
      C.setStatus(status, "");
      try {
        await C.api(endpoint, { method: "POST", body });
        form.hidden = true;
        if (invitation.example) {
          $("iv-done-msg").textContent =
            "This is the example invitation, so nothing was saved. On a real invitation a UK specialist would contact you to arrange a demonstration.";
        }
        $("iv-done").hidden = false;
        C.scrollTo($("iv-done"));
      } catch (err) {
        submit.disabled = false;
        submit.textContent = submitLabel;
        C.setStatus(status, err.message, "error");
      }
    });
  }
})();
