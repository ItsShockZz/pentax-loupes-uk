# PENTAX Loupes UK — dev quickstart

## Run it locally

```bash
cd pentax-loupes-uk
npx serve -l 8000
# then open http://localhost:8000
```

No build step, no dependencies to install — it's vanilla HTML/CSS/JS. Any
static server works, **but it must support HTTP Range requests** (see
below) — `npx serve` and VS Code's "Live Server" extension both do.

**Don't use plain `python3 -m http.server` for this project.** It doesn't
implement Range requests (always answers `200` + the whole file, never
`206` + `Content-Range`). `videos/tour-master.mp4` is ~37MB, and the hero
tour seeks around inside it as you scroll — without Range support, the
browser can buffer the first ~10-15 seconds and then simply can't fetch the
rest, so scrubbing past that point does nothing and the video looks
"stuck". It's a genuinely easy trap: nothing errors, the page loads fine,
autoplay/poster all work, and only scroll-scrubbing into unbuffered territory
silently fails — so if you must use `http.server` for some other reason, a
minimal `http.server.SimpleHTTPRequestHandler` subclass that answers Range
requests with `206`/`Content-Range` is a ~70-line fix (ask if you want one
dropped in). **This only matters for local dev** — every realistic
production host (Netlify, Vercel, Nginx, Apache, GitHub Pages,
S3+CloudFront) supports Range requests by default, so it doesn't affect the
deployed site.

Double-clicking `index.html` from Finder mostly works now (there's no
third-party embed requiring a real origin any more — see "Sketchfab was
removed" below) but is still not recommended: video `poster`/`src` loading
over `file://` behaves inconsistently across browsers, so serving over HTTP
is the reliable way to review the site.

See **[TODO.md](TODO.md)** for the full pre-launch checklist and
**[SECURITY.md](SECURITY.md)** for the security review.

## Sketchfab was removed

Earlier builds of this site embedded the PENTAX Loupes Sketchfab model as
the hero. It's gone now — the hero tour is scroll-scrubbed real product
video instead (see "Video tour" below). Two reasons:

1. **Reliability.** Across repeated testing the embed's load time ranged
   from a few seconds to 20+ seconds for no clear reason, and the exact same
   files sometimes failed to render the model at all over `localhost` with
   no error surfaced to the page (cross-origin iframes don't expose their
   internal console to the parent page, so this couldn't be fully
   root-caused from here).
2. **Licensing.** The model itself was uploaded to Sketchfab by a third
   party, not an official PENTAX account, under Sketchfab's default
   "Standard" license — no download enabled, all rights reserved to the
   uploader. It was never legitimate to extract or self-host regardless of
   the reliability issue.

Nothing stops re-adding a 3D viewer later as an opt-in "explore in 3D"
feature further down the page if a properly licensed/downloadable model
becomes available — see `TODO.md`.

## Video tour

The 01 section scrubs one continuous piece of real product footage instead
of a 3D camera or a set of separate clips: `videos/tour-master.mp4` is a
single file (the client's own edited video), and `js/product-tour.js` seeks
within it directly from scroll position as you scroll through the pinned
section — each of the 6 chapters owns a short `videoStart`–`videoEnd`
range inside that one file (verified frame by frame against the footage so
every chapter's copy matches what's on screen), the same "scroll scrubs a
video" technique used on Apple's product pages. The layout is fixed: copy
in a constant left column, video in a constant right slot — only the copy
crossfades and the footage changes. One glamour segment (22.6–30.0s, a
red/silvergold/black colourway run) is deliberately unwired; stills from it
live in `images/stills/` and illustrate the lower page instead.

An earlier build used 13 AI-generated clips instead of real footage; those
have been removed entirely and nothing here refers to them anymore.

## Dark mode

This is a dark-only site by design brief — there's no light theme or
toggle. All colour tokens live in `css/main.css`'s `:root` block
(`--bg`, `--bg-raised`, `--ink`, `--muted`, `--pentax-blue`, etc.).

## Lower page — beyond the pentaxloupes.com structure

Below the tour, several sections go beyond a direct port of
pentaxloupes.com's own layout: a connecting vertical line through the
"Why PENTAX" editorial rows, a count-up spec band before the configurator,
and a "Build your loupes" configurator (`#configure`) that funnels a
colour/magnification/lenses/light/use selection into a quote request (no
prices are shown anywhere — contractual). The configurator's live summary
is a bar fixed to the bottom-centre of the viewport while the section is on
screen (see `initConfigurator()`), and the magnification section carries a
"What's more important for you?" slider — field of view on the left,
magnification on the right — that recommends one of the five levels
(`initMagPrioritySlider()` in `js/main.js`). Every number in the spec band
restates a fact stated in full elsewhere on the same page — no customer
counts, countries-served, or review counts were invented to fill it out.
An earlier "At a glance" bento grid was removed on client direction. See
`TODO.md`'s rebuild note for the photo slots still waiting on client
images.

## Project structure

```
index.html
css/main.css          design system (dark-only), layout, responsive, reduced-motion
js/config.js           site config, magnifications, colours, testimonials
js/product-tour.js     scroll engine + video-scrub logic, chapter scene config
js/main.js             nav, FAQ, testimonials, selectors, form, scroll reveals, analytics hooks
images/                photography/diagrams (pentaxloupes.com) + tour poster frame
videos/                tour-master.mp4 — single continuous source video (see TODO.md)
```

## Loupe passport — `/p/<token>`, `/invite/<token>`, `/manage`

Every customer gets a private link (and a printable QR card for their case)
that opens their own passport: the pair they were fitted with, care guidance,
the fitting guide, accessories, a one-tap check-in, a support form and a link
to invite a colleague to a demonstration. The manager at `/manage` issues
passports, prints the cards and shows who needs attention.

How it fits the site:

- `passport.html`, `invite.html`, `manage.html` and `css/passport.css` use the
  same design system as `index.html` (dark, Inter, blue accent, pill buttons).
  Asset paths are root-absolute because of the clean-URL rewrites in
  `vercel.json`.
- `js/passport.js`, `js/invite.js`, `js/manage.js`, `js/passport-common.js`
  and `js/qr.js` are vanilla scripts: no inline JS, no `innerHTML`, and QR
  codes are inline SVG, so the CSP in `vercel.json` is unchanged.
- `api/` holds the Vercel Functions (`api/passport/[token].js`,
  `api/invite/[token].js`, `api/admin/passports.js`, `api/admin/activity.js`);
  shared code lives in `lib/passport/`. Every field is re-validated on the
  server; public POSTs are same-origin only, honeypot-checked, idempotent per
  request key and rate limited per passport and per IP.
- Storage is Redis over REST in production (Vercel's Upstash integration) and
  a JSON file in `.data/` locally. Until a database is connected nothing can
  be saved on Vercel, but the site and the example passport (`/p/example`)
  still work and `/manage` explains what to do.

Run it locally (replaces `npx serve` — same static site, with Range support,
plus the API):

```bash
npm run dev
```

Then open <http://127.0.0.1:8000/p/example>, `/invite/example` and `/manage`
(development key `pentax-dev`, or set `PASSPORT_ADMIN_KEY` in a local `.env`;
see `.env.example`). `npm test` runs the API, QR and option-list tests.

Go live, once:

1. Vercel → this project → **Storage** → Create Database → **Upstash for
   Redis** → connect it to the project. This injects `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`.
2. **Settings → Environment Variables** → add `PASSPORT_ADMIN_KEY` (a long
   random string; it is the only thing protecting `/manage`).
3. Optional email alerts for new requests: `RESEND_API_KEY` and
   `PASSPORT_NOTIFY_TO` (see `.env.example`).
4. Redeploy, open `https://<your-domain>/manage`, issue a passport, print the
   card.

## Enquiries and the CRM

Both homepage forms are live: "Request a demonstration" and the
configurator's quote request POST to `/api/lead` ([api/lead.js](api/lead.js)),
which re-validates every field ([lib/passport/leads.js](lib/passport/leads.js)),
stores the enquiry alongside the passport activity (it appears under "Needs
attention" at `/manage` as a *Website enquiry*), forwards it to the CRM and
emails the UK team when Resend is configured.

The CRM link is two environment variables on the website's Vercel project:

- `CRM_WEBHOOK_URL` — the CRM endpoint that accepts the JSON below.
- `CRM_WEBHOOK_SECRET` — sent as `Authorization: Bearer <secret>` (and
  `X-Webhook-Secret`) so the CRM can reject anything else.

Every record — website enquiries, passport check-ins, support requests and
colleague enquiries — is sent as one JSON object:

```json
{
  "source": "pentaxloupes.co.uk",
  "event": "enquiry | support | checkin | referral",
  "id": "uuid", "topic": "Demonstration request", "status": "open",
  "created_at": "2026-09-14T12:00:00.000Z",
  "name": "Dr Priya Shah", "email": "priya@example.com", "phone": "07700 900321",
  "practice": "Kensington Dental Studio", "postcode": "W8 5NP", "profession": "Dentistry",
  "message": "Mornings are best.",
  "details": { "magnification_interest": "3.5×", "preferred_contact": "Phone" },
  "passport": null
}
```

`details` carries the form-specific extras (the configurator sends `colour`,
`magnification`, `lenses`, `light`, `use`); `passport` is filled for passport
activity (`{ id, reference, name }`). Delivery is recorded on each item
(`crm_status`: sent / failed / unconfigured) and shown in `/manage`; a failed
hand-off never fails the customer's submission. Until the CRM endpoint exists,
enquiries are simply kept in `/manage` (and emailed, if Resend is set up).
