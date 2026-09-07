/**
 * product-tour.js
 * Scroll-driven product tour, scrubbed across one continuous piece of real
 * PENTAX Loupes product footage (videos/tour-master.mp4, 41s, client-edited).
 *
 * The tour drives a single <video> element: each chapter owns a short time
 * range within the file (`videoStart`/`videoEnd`), and scroll position within
 * the chapter maps to a seek inside that range. Using one element (instead of
 * the multi-clip approach an earlier build used) sidesteps a real Chrome
 * quirk found during development: a <video> that's never been rendered/played
 * can report readyState 4 while silently ignoring `currentTime` writes for
 * seconds at a time. A single, always-visible, always-active video never hits
 * that state.
 *
 * LAYOUT IS FIXED, ON PURPOSE. An earlier build alternated the video and the
 * copy left/right per chapter, which read as the whole screen jumping side to
 * side eleven times per scroll-through — the exact complaint that triggered
 * this rewrite. Now the copy always sits in one left-hand column and the
 * video always sits in one right-hand slot; the ONLY thing that changes
 * between chapters is the copy crossfading and the footage itself.
 *
 * SEEKING IS SMOOTHED, ON PURPOSE. Wheel scrolling arrives in ~100px steps,
 * and mapping those raw steps straight into `currentTime` made the footage
 * visibly stutter between wheel notches. `_update()` keeps a `_displayTime`
 * that eases toward the scroll-derived target each animation frame (short
 * time constant, so it still feels tied to the scroll), skips writes smaller
 * than half a frame, and never issues a new seek while the previous one is
 * still in flight — piling seeks on top of each other is what made the old
 * version "lag out" on slower machines.
 *
 * Architecture: a single tall wrapper (`.tour`) holds a `position: sticky`
 * stage (`.tour__stage`) plus one `.tour__chapter` panel per chapter, each
 * with its copy already present in the DOM (crawlable, works without JS —
 * the video's `poster` frame is a real frame from the footage, so there's
 * always something to see even before/without scripting).
 */

/* ---------------------------------------------------------------------- */
/* Math helpers                                                            */
/* ---------------------------------------------------------------------- */

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

const VIDEO_SRC = "videos/tour-master.mp4?v=20260826";

/* ---------------------------------------------------------------------- */
/* Scene config                                                            */
/*                                                                          */
/* `start`/`end` are fractions of the pinned scroll range. `videoStart`/    */
/* `videoEnd` are seconds within videos/tour-master.mp4 (41.0s total).      */
/*                                                                          */
/* Six chapters, each mapped to footage that actually shows what the copy   */
/* talks about — verified frame by frame against the file, not guessed:     */
/*                                                                          */
/*   overview       0.000–10.167  dark rotating reveal → hinge macro        */
/*   optics        10.167–14.667  rotating beauty shot, lenses to camera    */
/*   posture       14.667–17.542  clinician wearing them, looking ahead     */
/*   fit           17.542–22.583  nose pad head-on, lens macro, adjuster    */
/*   magnification 29.958–34.000  straight-on product, then looking through */
/*   colour        34.000–41.000  colourway run: blue, red, gold, black,    */
/*                                blue (each swatch button seeks to its own */
/*                                real shot — see COLOUR_VIDEO_MOMENTS in   */
/*                                main.js)                                  */
/*                                                                          */
/* 22.583–29.958 (a red/silvergold/black glamour run) is deliberately not   */
/* wired to a chapter — the old build played prescription-lens copy over    */
/* it, a text/footage mismatch. Stills from it are used in the lower page   */
/* instead (images/stills/). Scroll spans are proportional to each          */
/* chapter's footage duration so scrub speed feels constant throughout.     */
/* Chapter boundaries land on real cuts in the edit.                        */
/* ---------------------------------------------------------------------- */

/* "intro" is a full-bleed cold open: the dark rotating reveal plays edge to
   edge with no copy at all (there is no matching chapter element, so every
   chapter panel stays hidden while it's active — only the scroll cue
   shows). The hero copy arrives with the hinge-macro shot at 7.375s, when
   the layout snaps to the fixed copy-left/video-right arrangement used for
   the rest of the tour. */
/* The magnification chapter sits INSIDE the optics shot's own camera move:
   the footage physically zooms into the lens barrel (peak fill ~12.7-13.2s),
   at which point the sample-view overlay fades in over the frame - you're
   now looking THROUGH the loupe (images/mag-samples/, swapped by the 2.5x-5x
   buttons). Near the chapter's end the overlay lifts and the footage has
   already cut back to the receding front-on product (13.45-14.667s), so the
   sequence reads: zoom in -> through the lens -> zoom back out. Its scroll
   span is deliberately larger than its 1.7s of footage: people stop and
   click here. */
const productScenes = [
  { id: "intro", start: 0.0, end: 0.2303, videoStart: 0.0, videoEnd: 7.375, full: true },
  { id: "overview", start: 0.2303, end: 0.3175, videoStart: 7.375, videoEnd: 10.167 },
  { id: "optics", start: 0.3175, end: 0.4044, videoStart: 10.167, videoEnd: 12.95 },
  // videoStart === videoEnd on purpose: the footage parks on the
  // lens-fill frame for the whole chapter (fully covered by the sample
  // overlay anyway). The shot's zoom-back-out (13.45-14.667s) is not used
  // anywhere - removed on client direction.
  { id: "magnification", start: 0.4044, end: 0.5344, videoStart: 13.05, videoEnd: 13.05 },
  { id: "posture", start: 0.5344, end: 0.6242, videoStart: 14.667, videoEnd: 17.542 },
  { id: "fit", start: 0.6242, end: 0.7816, videoStart: 17.542, videoEnd: 22.583 },
  { id: "colour", start: 0.7816, end: 1.0, videoStart: 34.0, videoEnd: 41.0 },
];

/* ---------------------------------------------------------------------- */
/* ProductTour controller                                                  */
/* ---------------------------------------------------------------------- */

class ProductTour {
  constructor({ wrapperEl, railEl, videoEl }) {
    this.wrapperEl = wrapperEl;
    this.railEl = railEl;
    this.videoEl = videoEl;
    this.frameWrapEl = wrapperEl.querySelector(".tour__frame-wrap");

    this.chapterEls = Array.from(document.querySelectorAll("[data-chapter]"));
    this.cueEl = wrapperEl.querySelector(".tour__scroll-cue");
    this.endCtaEl = wrapperEl.querySelector(".tour__end-cta");
    this.magOverlayEl = wrapperEl.querySelector(".mag-overlay");
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.activeIndex = -1;
    this._primed = false;
    this._rafId = null;
    this._inView = false;
    this._lastUpdateAt = 0;
    this._lastFrameAt = 0;
    this._displayTime = null; // smoothed video time actually shown
    this._sizeMode = null; // "full" | "normal" — which layout _sizeFrame last applied
    this._seekIssuedAt = 0; // when the in-flight seek was written (0 = none)

    this._buildRail();
  }

  start() {
    if (!this.videoEl) return;
    this.videoEl.muted = true;
    // Clears the stuck-seek marker used by _update()'s retry logic below.
    this.videoEl.addEventListener("seeked", () => (this._seekIssuedAt = 0));

    if (this.reducedMotion) {
      // Static-but-real: park on a representative frame instead of
      // scrubbing (13.5s: the bright three-quarter beauty shot). Loaded via
      // the same blob path as the interactive tour so that this parking
      // seek — and any colour-swatch seek later — can't land on a stale
      // frame from an unbuffered byte range.
      this._loadVideoSource(() => (this.videoEl.currentTime = 13.5));
      return;
    }

    this.wrapperEl.classList.add("tour--cinematic");
    if (this.railEl) this.railEl.removeAttribute("hidden");

    this._loadVideoSource();

    this._bindScroll();
    this._observeViewport();
    this._setActiveChapter(0);
    this._sizeFrame(productScenes[0]);
  }

  /**
   * Loads the tour video as an in-memory blob instead of letting the
   * <video> stream it progressively over the network. A seek back to an
   * earlier, no-longer-buffered byte range mid-scroll can silently land on
   * a stale frame (same family of quirk as the readyState-4 issue in the
   * header comment). Once the whole file is a blob URL, every seek —
   * forward or backward — is served from memory, so it can't stall or go
   * stale. Falls back to plain progressive streaming if the fetch fails.
   */
  _loadVideoSource(onReady) {
    const bindAndLoad = (src) => {
      this.videoEl.addEventListener("loadedmetadata", () => this._primeVideo(onReady), { once: true });
      this.videoEl.src = src;
      this.videoEl.load();
      this.videoEl.pause();
    };

    // If the blob src itself fails to decode (e.g. the "video" was really
    // an HTML error/splash page served with a 200, which fetch can't tell
    // apart on status alone), fall back to plain progressive streaming
    // once instead of leaving the element permanently sourceless — without
    // this listener a decode failure meant the tour scrubbed text over a
    // frozen poster for the whole session.
    this.videoEl.addEventListener(
      "error",
      () => {
        if (this._triedProgressive) return;
        this._triedProgressive = true;
        bindAndLoad(VIDEO_SRC);
      }
    );

    // Bounded: a hung connection must degrade to progressive streaming,
    // not leave the tour scrub-dead with no src forever.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45000);

    fetch(VIDEO_SRC, { signal: abort.signal })
      .then((res) => {
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok || (type && !type.startsWith("video/") && !type.startsWith("application/octet-stream"))) {
          throw new Error(`${res.status} ${type}`);
        }
        return res.blob();
      })
      .then((blob) => bindAndLoad(URL.createObjectURL(blob)))
      .catch(() => bindAndLoad(VIDEO_SRC))
      .finally(() => clearTimeout(timer));
  }

  /**
   * A freshly-loaded <video> can report readyState 4 while silently
   * ignoring `currentTime` writes for anywhere from under a second up to
   * several seconds. This probes with a real, several-second seek and waits
   * for the `seeked` event that only fires once the browser has genuinely
   * completed it, retrying (~400ms apart, ~8s total) until one actually
   * lands, then calls back.
   */
  _primeVideo(onReady, attemptsLeft = 20) {
    const scene = productScenes[Math.max(0, this.activeIndex)] || productScenes[0];
    const base = scene && scene.videoStart != null ? scene.videoStart + 0.5 : 2;
    const probeTarget = Math.min(base, (this.videoEl.duration || 4) - 0.5);
    let settled = false;

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      this.videoEl.removeEventListener("seeked", onSeeked);
      this._primed = true;
      if (onReady) onReady();
      else this._requestFrame();
    };

    this.videoEl.addEventListener("seeked", onSeeked);
    this.videoEl.currentTime = probeTarget;
    this._seekIssuedAt = performance.now();

    setTimeout(() => {
      if (settled) return;
      this.videoEl.removeEventListener("seeked", onSeeked);
      settled = true;
      if (attemptsLeft <= 0) {
        // Give up gracefully rather than freeze the chapter forever — mark
        // primed anyway so scrubbing at least attempts normally.
        this._primed = true;
        if (onReady) onReady();
        else this._requestFrame();
        return;
      }
      this._primeVideo(onReady, attemptsLeft - 1);
    }, 400);
  }

  _buildRail() {
    if (!this.railEl) return;
    productScenes.forEach((scene, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "rail__dot";
      dot.setAttribute("aria-label", this._chapterLabel(scene.id));
      dot.addEventListener("click", () => this._scrollToScene(i));
      this.railEl.appendChild(dot);
    });
  }

  _chapterLabel(id) {
    if (id === "intro") return "Introduction";
    const panel = this.chapterEls.find((el) => el.dataset.chapter === id);
    const heading = panel && panel.querySelector("h1, h2, h3");
    return heading ? heading.textContent.trim() : id;
  }

  _scrollToScene(index) {
    const scene = productScenes[index];
    this.scrollToMoment(scene.id, scene.videoStart);
  }

  /**
   * Scrolls so the pinned tour lands on a specific moment (seconds within
   * videos/tour-master.mp4), not just a chapter's start — e.g. the "colour"
   * chapter is one continuous scroll range containing each colourway's real
   * shot back to back, so the colour swatch buttons in main.js can jump to
   * whichever one was clicked. Public: called from outside this class.
   */
  /**
   * Scrolls the page so the pinned tour sits at `local` (0..1) within the
   * given chapter — used by the magnification level buttons, whose zoom is
   * scroll-driven. Returns false when the cinematic tour isn't active.
   */
  scrollToChapterLocal(chapterId, local) {
    if (!this.wrapperEl.classList.contains("tour--cinematic")) return false;
    const scene = productScenes.find((s) => s.id === chapterId);
    if (!scene) return false;
    const rect = this.wrapperEl.getBoundingClientRect();
    const total = this.wrapperEl.offsetHeight - window.innerHeight;
    const progress = scene.start + clamp(local) * (scene.end - scene.start);
    const y = window.scrollY + rect.top + progress * total + 1;
    window.scrollTo({ top: y, behavior: "smooth" });
    return true;
  }

  scrollToMoment(chapterId, videoTime) {
    const scene = productScenes.find((s) => s.id === chapterId);
    if (!scene || scene.videoStart == null || scene.videoEnd == null) return;

    // Stacked (non-cinematic) mode: the scroll-position math below only
    // holds for the pinned 650vh layout, and there's no scrub loop to seek
    // the video from scroll anyway. Park the video directly on the
    // requested frame instead — no page jump. Checked against the applied
    // class, not the constructor-time flag, so it stays correct even if the
    // OS motion preference is toggled mid-session.
    if (!this.wrapperEl.classList.contains("tour--cinematic")) {
      this.videoEl.currentTime = videoTime;
      return;
    }

    const local = clamp((videoTime - scene.videoStart) / (scene.videoEnd - scene.videoStart));
    const rect = this.wrapperEl.getBoundingClientRect();
    const total = this.wrapperEl.offsetHeight - window.innerHeight;
    const progress = scene.start + local * (scene.end - scene.start);
    const y = window.scrollY + rect.top + progress * total + 1;
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  _observeViewport() {
    this._io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this._inView = entry.isIntersecting;
          // The rail is position:fixed, so without this it would float over
          // every section below the tour once unhidden.
          if (this.railEl) this.railEl.classList.toggle("rail--offscreen", !this._inView);
          if (this._inView) this._requestFrame();
        });
      },
      { threshold: 0 }
    );
    this._io.observe(this.wrapperEl);
  }

  _bindScroll() {
    window.addEventListener("scroll", () => this._onScroll(), { passive: true });
    window.addEventListener(
      "resize",
      () => {
        if (this.activeIndex >= 0) this._sizeFrame(productScenes[this.activeIndex]);
        this._onScroll();
      },
      { passive: true }
    );
    this._requestFrame();
  }

  /**
   * `requestAnimationFrame` can, in some embedding/focus-loss scenarios,
   * stop delivering callbacks indefinitely — observed directly: a scheduled
   * frame simply never fires, `_rafId` stays permanently non-null, every
   * later `_requestFrame()` call silently no-ops forever, and the tour
   * freezes on whatever chapter it last reached. Since scroll events fire
   * independently of rAF, this watchdog uses them as the recovery path: if
   * too long has passed since `_update()` last actually ran, rAF isn't
   * delivering, so clear the (stuck) pending id and update directly.
   * Time-gated so normal healthy scrolling still rides the smooth rAF path.
   */
  _onScroll() {
    if (performance.now() - this._lastUpdateAt > 250) {
      // Cancel (not just forget) any pending frame: a merely-delayed
      // callback that later fired would slip past _requestFrame's guard and
      // leave a second update loop running in parallel forever.
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = null;
      this._update();
    } else {
      this._requestFrame();
    }
    // Trailing guarantee: if rAF is dead, scroll events inside the 250ms
    // window schedule frames that never fire — so the END of a fling could
    // be dropped, parking the tour desynced until the next scroll. This
    // timer ensures one direct update lands after every burst regardless.
    clearTimeout(this._trailTimer);
    this._trailTimer = setTimeout(() => {
      if (performance.now() - this._lastUpdateAt > 200) {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
        this._update();
      }
    }, 300);
  }

  /**
   * Sizes and positions `.tour__frame-wrap` with explicit inline
   * width/height/left/top, computed here rather than left to CSS
   * aspect-ratio + vw/vh math (an aspect-ratio box whose width and
   * max-height come from separate rules didn't reliably re-resolve together
   * after class swaps in this codebase — computing exact pixels sidesteps
   * it). Two layouts only: the intro's full-bleed cold open, and the one
   * fixed arrangement every real chapter shares (desktop: video in a
   * constant right-hand slot clear of the fixed left copy column; mobile:
   * pinned top-centre with the copy below). It re-runs on a chapter change
   * only when the mode actually flips (intro → overview), so nothing about
   * the frame ever moves while scrolling through the chapters themselves.
   */
  _sizeFrame(scene) {
    if (!this.frameWrapEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = vw <= 900;
    const isFull = Boolean(scene && scene.full);
    // Full-bleed is a desktop treatment: fitting 16:9 into a portrait
    // phone's vw×vh yields a ~26vh strip centred on black, which for the
    // near-black intro footage read as a blank screen. Mobile uses its
    // normal top-anchored placement for the intro as well.
    const applyFull = isFull && !isMobile;
    const RATIO = 16 / 9;
    // Must match .tour__chapter's `padding: 0 6vw` and .tour__copy's
    // `max-width: 400px` in main.css — the video's size is derived from how
    // much room the text column actually needs.
    const CHAPTER_PADDING_FRAC = 0.06;
    const TEXT_COLUMN_WIDTH = 400;
    let maxW;
    let maxH;

    // Fixed nav is ~67px tall; keep the video's top edge clear of it.
    const NAV_CLEAR = 78;

    if (applyFull) {
      // The cold-open intro: no chapter copy exists for it at all, so
      // there's nothing to leave room for — genuinely edge-to-edge (the
      // 16:9 fit below letterboxes on other aspect ratios, invisibly,
      // since both the page and the footage's surround are black).
      maxW = vw;
      maxH = vh;
    } else if (isMobile) {
      maxW = vw * 0.92;
      maxH = vh * 0.34;
    } else {
      const gutter = vw * 0.03;
      // Wider right-hand clearance so the progress rail dots never sit on
      // top of the video's edge.
      const edgeMargin = Math.max(vw * 0.045, 64);
      const textZone = vw * CHAPTER_PADDING_FRAC + TEXT_COLUMN_WIDTH + gutter;
      maxW = Math.min(vw - textZone - edgeMargin, 1600);
      // Second term keeps the vertically-centred video from tucking under
      // the fixed nav on short, wide viewports where 0.88vh alone would.
      maxH = Math.min(vh * 0.88, vh - NAV_CLEAR * 2);
    }

    // Fit 16:9 inside the (maxW, maxH) budget — never crops or stretches.
    let w = maxW;
    let h = w / RATIO;
    if (h > maxH) {
      h = maxH;
      w = h * RATIO;
    }

    let left;
    let top;
    if (applyFull) {
      left = (vw - w) / 2;
      top = (vh - h) / 2;
    } else if (isMobile) {
      left = (vw - w) / 2;
      top = vh * 0.03 + 67; // clear the fixed nav
    } else {
      // Copy on the left, video pinned toward the right edge — same
      // clearance as the width budget above, so the rail dots sit in
      // clear space rather than on the frame.
      left = vw - Math.max(vw * 0.045, 64) - w;
      top = (vh - h) / 2;
    }

    this.frameWrapEl.style.width = `${Math.round(w)}px`;
    this.frameWrapEl.style.height = `${Math.round(h)}px`;
    this.frameWrapEl.style.left = `${Math.round(left)}px`;
    this.frameWrapEl.style.top = `${Math.round(top)}px`;
    // Full-bleed drops the card treatment (rounded corners + shadow).
    this.frameWrapEl.classList.toggle("tour__frame-wrap--full", applyFull);

    // Mobile chapter copy sits below the pinned video; publish the video's
    // actual bottom edge so the CSS padding tracks the real height (a
    // portrait phone's width-limited video is well short of the 34vh cap,
    // which a fixed worst-case padding would leave as a blank band). Skip
    // the desktop full-bleed intro: it has no copy, and overwriting the var
    // with the intro's geometry would shift the next chapter's padding.
    if (!applyFull) {
      this.wrapperEl.style.setProperty("--tour-video-bottom", `${Math.round(top + h)}px`);
    }

    // Committed last, deliberately: if anything above threw, the mode stays
    // un-committed and the per-frame invariant in _updateFrame retries the
    // whole sizing pass instead of trusting a half-applied layout.
    this._sizeMode = isFull ? "full" : "normal";
  }

  _requestFrame() {
    if (this._rafId || !this._inView) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._update();
    });
  }

  _update() {
    // try/finally: whatever happens inside a frame, the loop must schedule
    // the next one — a single thrown frame must never end the tour.
    try {
      this._updateFrame();
    } finally {
      if (this._inView) this._requestFrame();
    }
  }

  _updateFrame() {
    const now = performance.now();
    // Clamped frame delta for the easing below — a tab coming back from
    // being hidden shouldn't integrate a huge dt and teleport.
    const dt = Math.min(Math.max(now - this._lastFrameAt, 0), 100);
    this._lastFrameAt = now;
    this._lastUpdateAt = now;

    const rect = this.wrapperEl.getBoundingClientRect();
    const total = this.wrapperEl.offsetHeight - window.innerHeight;
    const progress = clamp(-rect.top / Math.max(total, 1));

    let idx = productScenes.findIndex((s) => progress >= s.start && progress < s.end);
    if (idx === -1) idx = progress >= 1 ? productScenes.length - 1 : 0;
    const scene = productScenes[idx];
    const local = clamp((progress - scene.start) / (scene.end - scene.start));

    // Guarded so an unexpected DOM error in the chapter/layout switch can
    // only lose one frame's worth of text update — never the scrub loop:
    // an uncaught throw here used to kill the rAF chain, freezing the whole
    // tour on whatever frame it happened to be showing.
    if (idx !== this.activeIndex) {
      try {
        this._setActiveChapter(idx);
      } catch (err) {
        // Un-commit so the switch is retried next frame — otherwise a
        // single throw left activeIndex pointing at a chapter whose DOM
        // never activated (blank copy, stale rail) with no retry path.
        this.activeIndex = -1;
        console.error("[tour] chapter switch failed", err);
      }
    }

    // Self-healing layout invariant: the frame's mode must match the active
    // scene EVERY frame, not only on the chapter-change edge. If any missed
    // transition, stale cached script, restored bfcache state, or swallowed
    // error above ever leaves the full-bleed intro layout applied outside
    // the intro (or vice versa), this corrects it within one frame instead
    // of letting the page sit visibly wrong.
    if (Boolean(scene.full) !== (this._sizeMode === "full")) this._sizeFrame(scene);

    // Scroll cue: visible through the whole textless cold open, gone just
    // before the first copy chapter arrives.
    if (this.cueEl) this.cueEl.classList.toggle("is-hidden", progress > 0.18);

    // End-of-tour CTA: fades in during the colour chapter's final shots.
    if (this.endCtaEl) {
      this.endCtaEl.classList.toggle("is-ready", scene.id === "colour" && local >= 0.8);
    }

    // Through-the-lens overlay: CUTS in as the magnification chapter begins
    // (the footage has just filled the frame with the lens) and stays up
    // for the WHOLE chapter — it cuts away only when the next chapter's
    // footage takes over. Hard cuts on purpose: a crossfade left the loupes
    // ghosted over the sample photo, and an end-of-chapter reveal window
    // meant the banana vanished for the last stretch of scrolling, both of
    // which read as bugs.
    if (this.magOverlayEl) {
      const on = scene.id === "magnification";
      this.magOverlayEl.style.opacity = on ? "1" : "0";
      this.magOverlayEl.classList.toggle("is-on", on);
      // Scroll drives the through-the-lens zoom: broadcast chapter-local
      // progress so main.js can scrub the sample photos with the scroll.
      if (on) {
        document.dispatchEvent(new CustomEvent("pentax:magscroll", { detail: { local } }));
      }
    }

    if (this._primed && scene.videoStart != null && scene.videoEnd != null) {
      // End one frame shy of the cut: a seek to a chapter's exact end
      // timestamp displays the FIRST frame of the next shot, so parking at
      // a chapter's last pixels used to show the wrong footage under its
      // copy (the reported full-bleed hinge frame at the intro's end was
      // this exact mechanism).
      const endGuard = Math.max(scene.videoStart, scene.videoEnd - 1 / 24);
      const target = lerp(scene.videoStart, endGuard, local);

      // Ease the displayed time toward the target instead of snapping to
      // every raw wheel step. τ ≈ 110ms: short enough to stay glued to the
      // scroll, long enough to absorb the stepping. Snap — never ease —
      // whenever the eased time sits outside the ACTIVE scene's own range:
      // easing across a cut paints the neighbouring chapter's footage under
      // this chapter's copy/layout (the |Δ|>3 check alone provably never
      // fired across the intro↔overview cut, whose maximum gap is 2.97s —
      // the root cause of the recurring stuck-hinge-frame report).
      const outsideScene = this._displayTime != null && (this._displayTime < scene.videoStart || this._displayTime > scene.videoEnd);
      if (this._displayTime == null || outsideScene || Math.abs(target - this._displayTime) > 3) {
        this._displayTime = target;
      } else {
        const k = 1 - Math.exp(-dt / 110);
        this._displayTime += (target - this._displayTime) * k;
      }

      // A seek can be in flight that WE never stamped (the prime probe, or
      // any external write) — stamp it, or the stuck-detection below could
      // never trigger and the gate would lock shut permanently.
      if (this.videoEl.seeking && this._seekIssuedAt === 0) this._seekIssuedAt = now;

      // Never stack a new seek on a healthy in-flight one, and skip
      // sub-half-frame writes: re-seeking to effectively the same frame
      // every rAF kept the decoder permanently busy in the old build. BUT a
      // seek still marked in-flight after 200ms is treated as stuck and
      // re-written — bypassing the delta gate too, because currentTime
      // reads back the issued target immediately, so at scroll rest the
      // delta is 0 and a gated retry would never fire.
      const seekStuck = this._seekIssuedAt !== 0 && now - this._seekIssuedAt > 200;
      const wantsWrite = Math.abs(this.videoEl.currentTime - this._displayTime) > 1 / 48;
      if ((!this.videoEl.seeking && wantsWrite) || (this.videoEl.seeking && seekStuck)) {
        this.videoEl.currentTime = this._displayTime;
        this._seekIssuedAt = now;
      }
    }
  }

  _setActiveChapter(idx) {
    // Only the copy changes between chapters — the video frame never moves,
    // with one deliberate exception: entering/leaving the full-bleed intro
    // snaps the frame between edge-to-edge and the shared chapter slot.
    // The outgoing chapter is hidden instantly while the incoming one gets
    // the CSS-defined fade-in; since at most one chapter is ever mid-fade,
    // fast scrolling can't ghost multiple copies together.
    this.activeIndex = idx;
    const scene = productScenes[idx];

    const mode = scene.full ? "full" : "normal";
    if (mode !== this._sizeMode) this._sizeFrame(scene);

    this.chapterEls.forEach((el) => {
      const shouldBeActive = el.dataset.chapter === scene.id;
      if (!shouldBeActive && el.classList.contains("is-active")) {
        el.style.transition = "none";
        el.classList.remove("is-active");
        void el.offsetWidth; // force the "none" above to actually apply
        el.style.transition = "";
      } else {
        el.classList.toggle("is-active", shouldBeActive);
      }
    });

    if (this.railEl) {
      Array.from(this.railEl.children).forEach((dot, i) => dot.classList.toggle("is-active", i === idx));
    }
  }
}

window.PentaxProductTour = { ProductTour, productScenes, clamp, lerp };
