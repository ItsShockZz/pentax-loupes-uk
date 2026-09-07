# TODO — before this can launch

Scannable punch list. See `README.md` for how to run the site locally, and
`SECURITY.md` for the full security review (what's fine, what's N/A because
there's no backend yet, and what becomes required the moment one exists).

**Architecture note:** the hero tour scrubs a single continuous video
(`videos/tour-master.mp4`) built from the client's own edited footage —
real PENTAX Loupes product video, not AI-generated (an earlier build used
13 AI-generated clips; those have been removed entirely). Each of the 11
narrative chapters seeks to its own short time range within that one file
(`videoStart`/`videoEnd` in `js/product-tour.js`) rather than loading a
separate clip per chapter. The lower page has additions beyond the original pentaxloupes.com content
structure — a connecting line through the "Why PENTAX" editorial rows, a
count-up spec band, and the "Build your loupes" configurator — see
"Lower-page additions" below. (An earlier "At a glance" bento grid was
removed on client direction in the 2026-08-26 rebuild.)

## 2026-08-26 rebuild — what changed & what's still needed

**Tour restructure (was 11 chapters + intro, now 6).** The tour was rebuilt
around what the footage actually shows: 6 chapters, each verified frame by
frame against `tour-master.mp4` (overview / optics / posture / fit /
magnification / colour), one fixed layout (copy always left, video always
right — the per-chapter left/right alternation is gone), and smoothed,
guarded seeking (see the header comment in `js/product-tour.js`). The
current `tour-master.mp4` is **41.0s** — the "placeholder segment at
56.6–65.6s" notes further down predate this file and no longer apply.
All four colour swatches (including Blue, at ~40.5s) now seek to real
colourway shots.

**Real stills extracted from the client's footage** into `images/stills/`
— now used in "Why PENTAX" and "Built around you" instead of the red
diagram PNGs (`images/technical-*.png`, no longer referenced — delete once
confirmed unneeded).

**Photo slots waiting for client images** (placeholders render until these
files exist, then they appear automatically, no code changes):
- `images/mag-samples/mag-2-5.jpg`, `mag-3-0.jpg`, `mag-3-5.jpg`, `mag-4-0.jpg`, `mag-5-0.jpg` — sample views through each magnification
- `images/led-wired.jpg`, `images/led-wireless.jpg` — LED headlight photos
- `images/colours/silvergold.jpg`, `blue.jpg`, `black.jpg`, `red.jpg` — configurator colour cards

**Configurator (`#configure`) has no backend** — same status as the demo
form: `initConfigurator()` in `js/main.js` validates and simulates; the
success message promises specialist contact **within 24 hours**, so wiring
the CRM endpoint (and honouring that promise operationally) is a launch
blocker. Consent on both forms is now a statement at the point of submission
instead of a checkbox; both consent notes still link to a placeholder
privacy policy (`href="#"`) — a real URL stays a launch blocker.

## 🔴 Blocking launch

**Content / contact facts**
- [ ] **UK phone number** — none exists in source material. `siteConfig.phone` is `null` and the phone row is hidden in the UI rather than showing a fake number. Get a real one, or confirm "email only" is fine long-term.
- [ ] **UK-specific contact email** — only `info@pentaxloupes.com` (general/EU) was found on pentaxloupes.com. Confirm this is correct for the UK site, or get a dedicated UK inbox.
- [ ] **Legal pages added 2026-09-07 as drafts** — privacy.html, terms.html, cookies.html, returns.html now exist and every consent note links to privacy.html (no more `href="#"` placeholders). Before launch: confirm legal entity/company number/registered address, set a retention period, confirm PENTAX trademark licensing wording and the commercial return/warranty terms, and have the four pages legally reviewed. Cookie banner deliberately NOT added: the site sets no cookies/storage and (since fonts were self-hosted) makes no third-party requests — revisit the moment analytics or a CRM script is added.
- [ ] **Distributor/partner/stock/warranty claims** — deliberately not made anywhere on the site (no source confirmation found). Decide if/when to add these, and get exact wording approved — don't let anyone add them without a source.

**Video footage — what's real, what's missing**
- [ ] **The lens-zoom segment still has placeholder text baked in.** The
  client's original edit had a ~9s pass zooming through the lens with an
  early placeholder overlay reading a magnification value that doesn't
  match the real spec (visibly reads "2.5p" at points, confirmed by direct
  frame extraction). Per instruction this was moved — via ffmpeg
  trim/concat, not re-exported from Premiere — from the middle of the
  timeline to the very end (now roughly 56.6s–65.6s of `tour-master.mp4`)
  rather than deleted, and is **not** wired to any chapter; the
  magnification chapter uses a separate held shot instead (33.0–35.0s).
  **This segment needs a clean replacement pass** — the client mentioned a
  proper microscope-zoom cut is coming — before it's wired to anything or
  shown prominently. Until then it just sits, unused, at the tail of the
  file.
- [ ] **Fixed during this build: the illumination chapter briefly bled into that placeholder segment.** `illumination` was originally mapped to
  54.0–65.5s, which crossed the 56.6s reorder boundary and would have shown
  the "2.5p" placeholder text during the LED-lighting chapter for roughly
  the last 80% of its scroll range — wrong subject *and* inaccurate text,
  in the chapter about illumination. Caught by walking through the ffmpeg
  segment math against every chapter's range and confirmed with direct
  frame extraction (t=50/55/56.3 clean, t=58/62 inside the placeholder
  segment). Fixed by narrowing `videoEnd` to `56.5` — confirmed clean via
  the same frame-extraction method. No other chapter's range overlaps that
  segment.
- [x] **Chapter-to-timestamp mapping re-verified in the 2026-08-26 rebuild.**
  The 6-chapter `productScenes` ranges were checked frame by frame against
  the current 41.0s file (contact sheets extracted directly from the video)
  so each chapter's copy matches what is actually on screen.
- [ ] **Local dev servers must support HTTP Range requests, or scrubbing silently breaks.** `tour-master.mp4` is ~37MB; browsers seek within large
  video files using byte-range requests. Plain `python3 -m http.server`
  does **not** implement Range requests (always answers `200` + the whole
  file, never `206` + `Content-Range`) — under that server, scrubbing past
  the first ~10–15s of buffered video does nothing and `currentTime`
  appears permanently stuck at 0, which looks exactly like a JS bug but
  isn't one. This is a **local-serving-only** issue — every realistic
  production host (Netlify, Vercel, Nginx, Apache, GitHub Pages,
  S3+CloudFront) supports Range requests by default, so it does not affect
  the deployed site. See the updated `README.md` for a Range-capable local
  dev server.

**Lower-page additions — sourcing**
- [ ] **The "Why PENTAX" connecting line, the count-up spec band, and the configurator are new** (not present in the original pentaxloupes.com
  structure; the earlier "At a glance" bento grid was removed on client
  direction). Every figure in the spec band restates a fact already stated
  in full elsewhere on this page (magnification range, FOV, working and
  pupillary distance) — nothing new was invented; no customer counts,
  countries-served, or review counts were added, since none of that exists
  in verified source material (see `SECURITY.md`'s and this file's
  long-standing no-fabrication rule). Worth a proofread pass once real
  business metrics (if any) become available to confirm whether any are
  worth adding honestly.

**Backend / integrations**
- [ ] **Demo form has no backend.** `js/main.js`'s `initDemoForm()` validates and *simulates* a submission — nothing is actually sent anywhere. Needs a real endpoint (CRM, email service, whatever the client uses). **When this happens: every client-side validation check must be re-run server-side too** (client-side is UX only, never a security boundary — see `SECURITY.md`), and the endpoint needs rate-limiting/spam protection before it's public.
- [ ] **Analytics isn't installed.** Key actions are already tagged and firing (`request_demo_nav`, `magnification_select`, `colour_select`, `faq_open`, etc. — see `track()` in `js/main.js`) but there's no provider wired up. Drop one in and point it at the existing hook.

**Security — hosting layer**
- [ ] **Set HTTP security headers** (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) once a host is chosen. A CSP matched to this site's actual dependencies, plus copy-pasteable config for Netlify/Vercel/Nginx, is ready to go in `SECURITY.md`.
- [ ] **Force HTTPS** — same story, host-config not code. Netlify/Vercel do this by default; the Nginx redirect snippet is in `SECURITY.md` if self-hosting.

## 🟡 Nice-to-have / polish

- [ ] **Full device/breakpoint sweep.** Spot-checked at ~375px, ~570px and ~1280px during the build (including real layout bug fixes on mobile — see below); the brief calls for 320/375/390/430/768/1024/1280/1440+/ultrawide. Worth a dedicated pass, especially the in-between tablet sizes and the configurator's single-column breakpoint.
- [ ] **Spam protection on the form** — no reCAPTCHA/hCaptcha/honeypot wired in yet. There's a natural place to add one in `initDemoForm()` before the "simulate submission" step.
- [ ] **Style attributes are inline in several places** (`style="..."` throughout `index.html`), which means a CSP needs `style-src 'unsafe-inline'`. Not a live risk today (no XSS injection point exists to combine it with — see `SECURITY.md`), but refactoring those into CSS classes would allow a stricter CSP later.
- [ ] **`tour-master.mp4` is ~37MB, all-intra encoded** (every frame a keyframe, for reliable seeking) — larger than a standard-GOP encode of the same footage would be. Worth a final pass with real device/network testing before launch; if load time on slower connections is a concern, a standard GOP interval (e.g. one keyframe/sec) would shrink the file considerably at some cost to seek precision.

## ✅ Already handled correctly (no action needed)

- No fabricated specs, prices, certifications, warranty periods, or customer counts — anything unverifiable is either omitted or explicitly marked. This applies to the spec band and configurator too (see "Lower-page additions" above).
- All testimonials are verbatim from pentaxloupes.com.
- FAQ, colour options, magnification/FOV table all sourced from pentaxloupes.com.
- Site works with JavaScript disabled (the tour's `<video poster>` shows a real frame; all chapter copy is present in plain HTML) and respects `prefers-reduced-motion` (footage still visible, parked on a representative frame, no scroll-scrubbing).
- Fixed real bugs during this build: the tour's chapter text collapsing to zero width on narrow viewports (a flex-item sizing quirk); the illumination chapter's video range bleeding into placeholder-text footage (see above); an invisible nav CTA caused by a CSS specificity collision; a non-pure-black background where pure black was requested.
- Security-reviewed: no `innerHTML`/`eval`/URL-param reflection anywhere (confirmed by direct grep, not assumption) — nothing on the site currently has an XSS surface. Demo form posts (not GETs) as a no-JS safety net, has `maxlength` caps on every field, and a real phone-shape check instead of a length check. Full findings in `SECURITY.md`.
