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
