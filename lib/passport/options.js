/**
 * Loupe passport — shared option lists (server-side source of truth).
 *
 * The browser copy lives in js/passport-common.js (PassportCommon.OPTIONS);
 * tests/options.test.mjs fails if the two ever drift apart. Values mirror the
 * configurator and demo form on index.html so a passport describes a pair
 * exactly the way the site sells it.
 */

export const OPTIONS = {
  discipline: ["Dentistry", "Surgery", "Veterinary", "Other"],
  magnification: ["2.5", "3.0", "3.5", "4.0", "5.0"],
  colour: ["Silvergold", "Blue", "Black", "Red"],
  light: ["No light", "Wired LED", "Wireless LED"],
  lenses: ["Yes", "No"],
  prescription: ["None", "Own glasses underneath", "Prescription insert"],
};

// Field of view per magnification, in mm — same figures as js/config.js.
export const FIELD_OF_VIEW = { "2.5": 141, "3.0": 120, "3.5": 106, "4.0": 98, "5.0": 80 };

export const SUPPORT_TOPICS = [
  "Fitting or adjustment",
  "Cleaning and care",
  "Headlight or accessory",
  "Prescription or lenses",
  "Update my details",
  "Something else",
];

export const CHECKIN_FEELINGS = ["good", "help"];

// Adjustable ranges quoted on the site (working distance cm, pupillary distance mm).
export const LIMITS = { workingDistance: [25, 70], pupillaryDistance: [52, 78] };
