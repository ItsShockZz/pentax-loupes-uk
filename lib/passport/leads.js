/**
 * Website enquiries — the "Request a demonstration" form and the
 * configurator's quote request. They are validated here, stored as the same
 * activity records the passport manager lists (under the pseudo-passport
 * "website"), and forwarded to the CRM by forwardToCrm() in service.js.
 *
 * Option lists mirror the markup in index.html (profession select,
 * configurator chips) — keep them in step when the site changes.
 */
import { HttpError } from "./http.js";
import { choice, emailField, text } from "./service.js";

export const LEAD_OPTIONS = {
  profession: ["Dentistry", "Surgery", "Veterinary", "Other"],
  magnificationInterest: ["2.5×", "3.0×", "3.5×", "4.0×", "5.0×"],
  preferredContact: ["Email", "Phone"],
  colour: ["Silvergold", "Blue", "Black", "Red"],
  magnification: ["2.5×", "3.0×", "3.5×", "4.0×", "5.0×", "Not sure, advise me"],
  lenses: ["Yes", "No", "Advise me"],
  light: ["Wireless LED", "Wired LED", "No light"],
  use: ["Medical practice", "Dental practice", "Other"],
};

/**
 * What a visitor agrees to by submitting a form, recorded with the enquiry.
 *
 * The statement is printed beside each submit button (the paragraph marked
 * data-consent in index.html) and the browser sends only the version it was
 * showing. What is recorded is the words below, not whatever the browser says,
 * so the CRM keeps exactly what was on the page as the evidence. Change a
 * statement here and in index.html together and bump the version: a visitor
 * on an older page then records nothing, which is the safe way to be wrong.
 *
 * The agreement covers contact about the enquiry, WhatsApp included. It is not
 * marketing consent, which the privacy policy says needs a separate yes.
 */
export const CONSENT_VERSION = "v1";
const CONSENT_BODY =
  "PENTAX Loupes UK (Smooth Optics) may contact you about your enquiry by phone, email and WhatsApp, including video call links and reminders. Reply STOP to a WhatsApp message and we will stop.";
export const CONSENT_STATEMENTS = Object.freeze({
  quote: `By requesting your quote you agree that ${CONSENT_BODY}`,
  demo: `By submitting this form you agree that ${CONSENT_BODY}`,
});

/** The agreement a submission carries (version, form and the words), or null when the page that sent it showed no statement. */
export function consentField(data, form) {
  const shown = text(data, "consent", { max: 10 });
  if (shown !== CONSENT_VERSION || !CONSENT_STATEMENTS[form]) return null;
  return { version: CONSENT_VERSION, form, statement: CONSENT_STATEMENTS[form] };
}

/** Records from the website hang off this pseudo-passport in the manager. */
export const WEBSITE_PASSPORT = Object.freeze({ id: "website", name: "Website", reference: "", token: "" });

function phoneField(data, key, { required = true } = {}) {
  const value = text(data, key, { max: 40, required, label: "a phone number" });
  if (value && !/^\+?[\d\s()-]{7,24}$/.test(value)) {
    throw new HttpError(400, "Please enter a valid phone number.", { field: key });
  }
  return value;
}

/** The demonstration request form (index.html #request-demo). */
export function demoEntry(data) {
  return {
    kind: "enquiry",
    status: "open",
    topic: "Demonstration request",
    name: text(data, "fullName", { max: 120, required: true, label: "your full name" }),
    email: emailField(data),
    phone: phoneField(data, "phone"),
    practice: text(data, "practice", { max: 160, required: true, label: "your practice or company" }),
    profession: choice(data, "profession", LEAD_OPTIONS.profession, { label: "profession" }),
    postcode: text(data, "postcode", { max: 12, required: true, label: "your postcode" }),
    message: text(data, "message", { max: 2000 }),
    consent: consentField(data, "demo"),
    details: {
      magnification_interest:
        choice(data, "magnificationInterest", LEAD_OPTIONS.magnificationInterest, { required: false, label: "magnification" }) ||
        "Not sure yet",
      preferred_contact:
        choice(data, "preferredContact", LEAD_OPTIONS.preferredContact, { required: false, label: "contact method" }) || "Email",
    },
  };
}

/** The configurator's quote request (index.html #configure). */
export function quoteEntry(data) {
  const raw = data.configuration;
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const configuration = {
    colour: choice(cfg, "colour", LEAD_OPTIONS.colour, { label: "colour" }),
    magnification: choice(cfg, "magnification", LEAD_OPTIONS.magnification, { label: "magnification" }),
    lenses: choice(cfg, "lenses", LEAD_OPTIONS.lenses, { label: "protective lenses option" }),
    light: choice(cfg, "light", LEAD_OPTIONS.light, { label: "light option" }),
    use: choice(cfg, "use", LEAD_OPTIONS.use, { label: "intended use" }),
  };
  return {
    kind: "enquiry",
    status: "open",
    topic: "Quote request",
    name: text(data, "name", { max: 120, required: true, label: "your full name" }),
    email: emailField(data),
    phone: phoneField(data, "phone"),
    practice: text(data, "practice", { max: 160 }),
    postcode: text(data, "postcode", { max: 12 }),
    message: text(data, "message", { max: 2000 }),
    consent: consentField(data, "quote"),
    details: configuration,
  };
}

export function leadEntry(data) {
  const kind = text(data, "kind", { max: 20 });
  if (kind === "demo") return demoEntry(data);
  if (kind === "quote") return quoteEntry(data);
  throw new HttpError(400, "Please try again.");
}

/** One-line summary for emails and the manager. */
export function describeDetails(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
    .join(" · ");
}
