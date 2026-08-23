/**
 * Central content, product and site configuration.
 * All factual data below is sourced from https://www.pentaxloupes.com/ (fetched during build).
 * Nothing here is invented. Anything not confirmed by source material is
 * explicitly marked "NEEDS CLIENT CONFIRMATION".
 */

/* ------------------------------------------------------------------------ */
/* Site / contact configuration                                             */
/* ------------------------------------------------------------------------ */

const siteConfig = {
  brandName: "PENTAX Loupes UK",
  domain: "pentaxloupes.co.uk",
  // Source (pentaxloupes.com) only publishes a general/EU contact channel, not a
  // UK-specific line. Do not present this as a UK phone number.
  contactEmail: "info@pentaxloupes.com", // NEEDS CLIENT CONFIRMATION: confirm a UK-specific inbox before launch
  phone: null, // NEEDS CLIENT CONFIRMATION: no UK phone number found in source material — do not fabricate one
  demoUrl: "#request-demo",
};

/* ------------------------------------------------------------------------ */
/* Product data — magnifications, ranges, colours                          */
/* Source: pentaxloupes.com specification table + FAQ                       */
/* ------------------------------------------------------------------------ */

const magnifications = [
  { value: 2.5, label: "2.5×", fov: 141, guidance: "Broad field of view and approachable magnification." },
  { value: 3.0, label: "3.0×", fov: 120, guidance: "A useful balance of magnification and field of view." },
  { value: 3.5, label: "3.5×", fov: 106, guidance: "Higher detail while retaining a practical working field." },
  { value: 4.0, label: "4.0×", fov: 98, guidance: "For clinicians requiring finer visual detail." },
  { value: 5.0, label: "5.0×", fov: 80, guidance: "High magnification for very detailed work." },
];

// Working distance 25–70 cm, pupillary distance 52–78 mm: referenced in prose
// throughout index.html (chapters 5/6, "Built around you", magnification
// range spec strip). No JS reads these values, so they're not duplicated
// here as a config object — see the FAQ note further down about why purely
// presentational numbers are authored directly in the markup.

// Swatch colours themselves are set inline on the buttons in index.html
// (they're presentational); this list drives the accessible label text that
// main.js writes into [data-colour-label] when a swatch is selected.
const colours = [
  { id: "silvergold", label: "Silvergold" },
  { id: "blue", label: "Blue" },
  { id: "black", label: "Black" },
  { id: "red", label: "Red" },
];

/* ------------------------------------------------------------------------ */
/* Testimonials — verbatim, from pentaxloupes.com. None fabricated.         */
/* ------------------------------------------------------------------------ */

const testimonials = [
  {
    quote:
      "With PENTAX loupes, the posture of my neck really changed. I can look straight ahead, just like working with a microscope, and I enjoy parallel viewing with a very large field of view.",
    name: "Dr Robotti",
    role: "President, The Rhinoplasty Society of Europe",
    image: "images/testimonial-robotti.jpg",
  },
  {
    quote:
      "With the PENTAX Loupes I have a wide field of vision and they are light to wear. You can keep your focus while looking straight ahead, which minimises strain on my neck.",
    name: "Dr Dhooghe",
    role: "Surgeon",
    image: "images/testimonial-dhooghe.jpg",
  },
  {
    quote: "These loupes are just great. I felt a difference in my posture the very first time I tried them!",
    name: "Dr Hsu",
    role: "Dentist",
    image: "images/testimonial-hsu.jpg",
  },
  {
    quote: "Great posture, magnificent view, fit eyes. Welcome PENTAX Loupes; bye bye cervical hernia!",
    name: "Dr Cappelle",
    role: "Surgeon",
    image: "images/testimonial-cappelle.jpg",
  },
];

/* ------------------------------------------------------------------------ */
/* Note on FAQ content: rewritten from pentaxloupes.com and authored         */
/* directly as static markup in index.html (#faq-list), not generated from  */
/* a JS config object. That keeps the FAQ fully readable/crawlable with no  */
/* JS at all — main.js only progressively enhances it into an accordion.    */
/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */
/* Note on the "Why PENTAX", "Built around you" and "Who it's for" sections: */
/* like the FAQ above, these are purely presentational (no selector logic,  */
/* no camera nudge, nothing else in JS reads them) and are authored directly */
/* as static markup in index.html so they stay crawlable/no-JS-safe without  */
/* an extra render step. Their copy is drawn from the same verified facts   */
/* as everything else in this file — see the FOV/PD/working-distance values */
/* in `magnifications` above, and the working-distance/PD note above that.  */
/*                                                                          */
/* This is a plain classic script (loaded via <script src="js/config.js">, */
/* not a module), so the consts above are simply in scope for the scripts  */
/* loaded after it (product-tour.js, main.js).                             */
/* ------------------------------------------------------------------------ */
