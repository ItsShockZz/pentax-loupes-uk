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
    message: text(data, "message", { max: 2000 }),
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
